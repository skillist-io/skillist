import { isBinaryAssetPath } from "./binary.js";
import type { SkillBundle } from "./index.js";
import { parsePluginManifest } from "./plugin.js";

export type SecurityIssue = {
  severity: "low" | "medium" | "high" | "critical";
  path: string;
  message: string;
  ruleId?: string;
};

export type SecurityScanResult = {
  status: "pass" | "advisory" | "fail";
  issues: SecurityIssue[];
  score: number;
};

const CREDENTIAL_PATTERNS: { ruleId: string; re: RegExp; message: string }[] = [
  { ruleId: "cred-aws", re: /AKIA[0-9A-Z]{16}/, message: "Possible AWS access key" },
  { ruleId: "cred-stripe", re: /sk_live_[a-zA-Z0-9]+/, message: "Possible Stripe live secret" },
  {
    ruleId: "cred-ghp",
    re: /ghp_[a-zA-Z0-9]{36}/,
    message: "Possible GitHub personal access token",
  },
  { ruleId: "cred-slack", re: /xox[baprs]-[a-zA-Z0-9-]+/, message: "Possible Slack token" },
  {
    ruleId: "cred-pem",
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: "Private key material detected",
  },
  {
    ruleId: "cred-openai",
    re: /sk-[a-zA-Z0-9]{20,}/,
    message: "Possible OpenAI-style API key",
  },
];

const SUSPICIOUS_PATTERNS: {
  ruleId: string;
  re: RegExp;
  message: string;
  severity: SecurityIssue["severity"];
}[] = [
  { ruleId: "script-eval", re: /\beval\s*\(/, message: "eval() usage", severity: "high" },
  {
    ruleId: "script-child-process",
    re: /child_process/,
    message: "child_process usage",
    severity: "medium",
  },
  { ruleId: "script-exec", re: /\bexec\s*\(/, message: "exec() usage", severity: "medium" },
  {
    ruleId: "script-rm-rf",
    re: /rm\s+-rf\s+\//,
    message: "Destructive rm -rf / pattern",
    severity: "critical",
  },
  {
    ruleId: "script-pipe-bash",
    re: /curl\s+.*\|\s*(ba)?sh/,
    message: "Remote script piped to shell",
    severity: "critical",
  },
  {
    ruleId: "script-wget-sh",
    re: /wget\s+.*\|\s*(ba)?sh/,
    message: "Remote script piped to shell",
    severity: "critical",
  },
  {
    ruleId: "script-base64-exec",
    re: /base64\s+(-d|--decode).*\|/,
    message: "Base64-decoded payload execution",
    severity: "high",
  },
];

const PROMPT_INJECTION_PATTERNS: { ruleId: string; re: RegExp; message: string }[] = [
  {
    ruleId: "pi-ignore",
    re: /ignore (all )?(previous|prior) instructions/i,
    message: "Possible prompt-injection: ignore previous instructions",
  },
  {
    ruleId: "pi-disregard",
    re: /disregard (your|the) (system|safety)/i,
    message: "Possible prompt-injection: disregard system/safety",
  },
  {
    ruleId: "pi-roleplay",
    re: /you are now (in )?(DAN|developer mode|unrestricted)/i,
    message: "Possible prompt-injection: role override",
  },
  {
    ruleId: "pi-exfil",
    re: /send (all |the )?(secrets?|credentials?|api keys?) (to|via)/i,
    message: "Possible data-exfiltration instruction",
  },
];

const OBFUSCATION_PATTERNS: { ruleId: string; re: RegExp; message: string }[] = [
  {
    ruleId: "obf-long-hex",
    re: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){20,}/i,
    message: "Long hex-escaped sequence (possible obfuscation)",
  },
  {
    ruleId: "obf-fromcharcode",
    re: /String\.fromCharCode\s*\(\s*\d+(\s*,\s*\d+){10,}/,
    message: "String.fromCharCode obfuscation pattern",
  },
];

export type SecurityScorer = (
  files: SkillBundle,
) => SecurityScanResult | Promise<SecurityScanResult>;

/** Heuristic baseline scorer — always available, no external deps. */
export function scanSkillSecurity(files: SkillBundle): SecurityScanResult {
  const issues: SecurityIssue[] = [];

  for (const [path, content] of files.entries()) {
    // Base64 asset content isn't source — regex credential/pattern scanning
    // over it is meaningless and prone to false positives.
    if (isBinaryAssetPath(path)) continue;

    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.re.test(content)) {
        issues.push({
          severity: "critical",
          path,
          message: pattern.message,
          ruleId: pattern.ruleId,
        });
      }
    }

    if (path.startsWith("scripts/") || /\.(sh|bash|py|js|mjs|cjs|ts)$/.test(path)) {
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.re.test(content)) {
          issues.push({
            severity: pattern.severity,
            path,
            message: pattern.message,
            ruleId: pattern.ruleId,
          });
        }
      }
    }

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.re.test(content)) {
        issues.push({
          severity: "high",
          path,
          message: pattern.message,
          ruleId: pattern.ruleId,
        });
      }
    }

    for (const pattern of OBFUSCATION_PATTERNS) {
      if (pattern.re.test(content)) {
        issues.push({
          severity: "high",
          path,
          message: pattern.message,
          ruleId: pattern.ruleId,
        });
      }
    }

    const urlMatches = content.match(/https?:\/\/[^\s)"']+/g) ?? [];
    for (const url of urlMatches) {
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) continue;
      if (/\.(zip|exe|dmg|pkg|sh|bat)(\?|$)/i.test(url)) {
        issues.push({
          severity: "medium",
          path,
          message: `External executable URL: ${url.slice(0, 80)}`,
          ruleId: "url-executable",
        });
      }
      if (
        /raw\.githubusercontent\.com|gist\.githubusercontent\.com/i.test(url) &&
        /\|/.test(content)
      ) {
        issues.push({
          severity: "medium",
          path,
          message: "Fetches remote content that may be piped to a shell",
          ruleId: "url-remote-pipe-risk",
        });
      }
    }

    if (content.length > 512_000) {
      issues.push({
        severity: "medium",
        path,
        message: "File exceeds 512KB — unusually large for a skill",
        ruleId: "size-large",
      });
    }
  }

  // Surface a declared per-skill egress allowlist as a review signal. Low
  // severity, so it never blocks publishing on its own — its purpose is to make
  // the skill's outbound network intent visible to a reviewer (a skill declaring
  // unexpected hosts is a judgment call, not a mechanical fail).
  const pluginRaw = files.get("plugin.json");
  if (pluginRaw) {
    const declaredHosts = parsePluginManifest(pluginRaw)?.network?.allowedHosts ?? [];
    if (declaredHosts.length > 0) {
      issues.push({
        severity: "low",
        path: "plugin.json",
        message: `Declares outbound network access to: ${declaredHosts.join(", ")}`,
        ruleId: "network-egress-declared",
      });
    }
  }

  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasHigh = issues.some((i) => i.severity === "high");
  const hasMedium = issues.some((i) => i.severity === "medium");

  const status: SecurityScanResult["status"] =
    hasCritical || hasHigh ? "fail" : hasMedium ? "advisory" : "pass";

  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 40;
    else if (issue.severity === "high") score -= 25;
    else if (issue.severity === "medium") score -= 10;
    else score -= 3;
  }

  return {
    status,
    issues,
    score: Math.max(0, Math.min(100, score)),
  };
}

let customScorer: SecurityScorer | null = null;

/** Register an optional external scorer (e.g. commercial API). Falls back to heuristic. */
export function setSecurityScorer(scorer: SecurityScorer | null): void {
  customScorer = scorer;
}

export async function runSecurityScan(files: SkillBundle): Promise<SecurityScanResult> {
  if (customScorer) {
    return customScorer(files);
  }
  return scanSkillSecurity(files);
}
