import type { SecurityScanResult, SkillReviewResult } from "@skillist/skill-format";

export type PublishPolicy = {
  minQualityScore?: number;
  requireSecurityPass?: boolean;
  blockOnAdvisory?: boolean;
  minEvalUplift?: number;
  requireEval?: boolean;
};

export type EvalGateInput = {
  status: string;
  uplift: number | null;
} | null;

export function evaluatePublishPolicy(
  policy: PublishPolicy | null | undefined,
  review: SkillReviewResult,
  security: SecurityScanResult,
  evalResult?: EvalGateInput,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const minQuality = policy?.minQualityScore ?? 0;

  if (review.score < minQuality) {
    reasons.push(`Quality score ${review.score} is below minimum ${minQuality}`);
  }

  if (policy?.requireSecurityPass && security.status !== "pass") {
    reasons.push(`Security status is ${security.status} (pass required)`);
  }

  if (policy?.blockOnAdvisory && security.status === "advisory") {
    reasons.push("Security advisory issues must be resolved before publish");
  }

  if (security.status === "fail") {
    reasons.push("Security scan failed — resolve high-severity issues");
  }

  if (policy?.requireEval) {
    if (!evalResult || evalResult.status !== "completed") {
      reasons.push("A completed eval run is required before publish");
    }
  }

  if (policy?.minEvalUplift != null) {
    const uplift = evalResult?.uplift;
    if (uplift == null) {
      reasons.push(`Eval uplift is required (minimum +${policy.minEvalUplift})`);
    } else if (uplift < policy.minEvalUplift) {
      reasons.push(`Eval uplift +${uplift} is below minimum +${policy.minEvalUplift}`);
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
