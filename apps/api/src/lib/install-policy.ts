import type { InstallPolicy, SecuritySeverity } from "@skillist/contracts";

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Map Skillist security_status to Tessl-like severity for policy thresholds. */
export function securityStatusToSeverity(
  status: "pass" | "advisory" | "fail" | null | undefined,
): SecuritySeverity {
  if (status === "fail") return "high";
  if (status === "advisory") return "medium";
  return "low";
}

export function maxIssueSeverity(issues: { severity: string }[]): SecuritySeverity {
  let max: SecuritySeverity = "low";
  for (const issue of issues) {
    const s = issue.severity as SecuritySeverity;
    if (s in SEVERITY_RANK && SEVERITY_RANK[s] > SEVERITY_RANK[max]) {
      max = s;
    }
  }
  return max;
}

export type InstallCheckInput = {
  skillOrgSlug: string;
  policyOrgSlug: string;
  source: "registry" | "git";
  gitHost?: string;
  publishedAt?: Date | null;
  securityStatus?: "pass" | "advisory" | "fail" | null;
  securityIssues?: { severity: string; path: string; message: string }[];
};

export type InstallCheckResult = {
  allowed: boolean;
  decision: "allow" | "warn" | "block";
  reasons: string[];
  severity: SecuritySeverity;
  headline: "Passed" | "Advisory" | "Risky" | "Critical";
};

function headlineFor(severity: SecuritySeverity): InstallCheckResult["headline"] {
  if (severity === "critical") return "Critical";
  if (severity === "high") return "Risky";
  if (severity === "medium") return "Advisory";
  return "Passed";
}

export function evaluateInstallPolicy(
  policy: InstallPolicy | null | undefined,
  input: InstallCheckInput,
): InstallCheckResult {
  const reasons: string[] = [];
  const issueSeverity = input.securityIssues?.length
    ? maxIssueSeverity(input.securityIssues)
    : securityStatusToSeverity(input.securityStatus);
  const severity = issueSeverity;
  const p = policy ?? {};

  const allowedSources = p.allowedSources ?? "registry_any";
  if (input.source === "git") {
    if (allowedSources === "registry_org_only" || allowedSources === "registry_any") {
      reasons.push("Git sources are not allowed by install policy");
    } else if (p.gitAllowlist?.length) {
      const host = (input.gitHost ?? "").toLowerCase();
      const ok = p.gitAllowlist.some(
        (entry) => host === entry.toLowerCase() || host.startsWith(`${entry.toLowerCase()}/`),
      );
      if (!ok) {
        reasons.push(`Git host "${input.gitHost ?? "?"}" is not in the allowlist`);
      }
    }
  } else if (allowedSources === "registry_org_only" && input.skillOrgSlug !== input.policyOrgSlug) {
    reasons.push(`Only skills from org "${input.policyOrgSlug}" may be installed`);
  }

  if (p.minReleaseAgeDays != null && p.minReleaseAgeDays > 0 && input.publishedAt) {
    const ageMs = Date.now() - input.publishedAt.getTime();
    const minMs = p.minReleaseAgeDays * 24 * 60 * 60 * 1000;
    if (ageMs < minMs) {
      reasons.push(`Release is younger than minimum age of ${p.minReleaseAgeDays} day(s)`);
    }
  }

  let decision: InstallCheckResult["decision"] = "allow";
  if (p.blockSeverity && SEVERITY_RANK[severity] >= SEVERITY_RANK[p.blockSeverity]) {
    decision = "block";
    reasons.push(`Security severity ${severity} meets block threshold (${p.blockSeverity})`);
  } else if (p.warnSeverity && SEVERITY_RANK[severity] >= SEVERITY_RANK[p.warnSeverity]) {
    decision = "warn";
    reasons.push(`Security severity ${severity} meets warn threshold (${p.warnSeverity})`);
  }

  // Source/age violations always block
  const hardBlock = reasons.some(
    (r) =>
      r.includes("not allowed") ||
      r.includes("allowlist") ||
      r.includes("Only skills from") ||
      r.includes("younger than"),
  );
  if (hardBlock) decision = "block";

  return {
    allowed: decision !== "block",
    decision,
    reasons,
    severity,
    headline: headlineFor(severity),
  };
}
