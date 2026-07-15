import type { SkillBundle } from "./index.js";

export type SecurityIssue = {
  severity: "low" | "medium" | "high";
  path: string;
  message: string;
};

export type SecurityScanResult = {
  status: "pass" | "advisory" | "fail";
  issues: SecurityIssue[];
};

const CREDENTIAL_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /sk_live_[a-zA-Z0-9]+/,
  /ghp_[a-zA-Z0-9]{36}/,
  /xox[baprs]-[a-zA-Z0-9-]+/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
];

const SUSPICIOUS_PATTERNS = [
  /eval\s*\(/,
  /child_process/,
  /exec\s*\(/,
  /rm\s+-rf\s+\//,
  /curl\s+.*\|\s*bash/,
  /wget\s+.*\|\s*sh/,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /disregard (your|the) (system|safety)/i,
  /you are now (in )?/i,
];

export function scanSkillSecurity(files: SkillBundle): SecurityScanResult {
  const issues: SecurityIssue[] = [];

  for (const [path, content] of files.entries()) {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(content)) {
        issues.push({
          severity: "high",
          path,
          message: "Possible hardcoded credential detected",
        });
      }
    }

    if (path.startsWith("scripts/")) {
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
          issues.push({
            severity: "medium",
            path,
            message: "Potentially dangerous script pattern",
          });
        }
      }
    }

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        issues.push({
          severity: "medium",
          path,
          message: "Possible prompt-injection phrase",
        });
      }
    }

    const urlMatches = content.match(/https?:\/\/[^\s)]+/g) ?? [];
    for (const url of urlMatches) {
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) continue;
      if (/\.(zip|exe|dmg|pkg|sh|bat)(\?|$)/i.test(url)) {
        issues.push({
          severity: "low",
          path,
          message: `External executable URL: ${url.slice(0, 80)}`,
        });
      }
    }

    if (content.length > 512_000) {
      issues.push({
        severity: "medium",
        path,
        message: "File exceeds 512KB — unusually large for a skill",
      });
    }
  }

  const hasHigh = issues.some((i) => i.severity === "high");
  const hasMedium = issues.some((i) => i.severity === "medium");

  return {
    status: hasHigh ? "fail" : hasMedium ? "advisory" : "pass",
    issues,
  };
}
