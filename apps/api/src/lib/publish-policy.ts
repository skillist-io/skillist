import type { SecurityScanResult, SkillReviewResult } from "@skillist/skill-format";

export type PublishPolicy = {
  minQualityScore?: number;
  requireSecurityPass?: boolean;
  blockOnAdvisory?: boolean;
};

export function evaluatePublishPolicy(
  policy: PublishPolicy | null | undefined,
  review: SkillReviewResult,
  security: SecurityScanResult,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const minQuality = policy?.minQualityScore ?? 0;

  if (review.score < minQuality) {
    reasons.push(
      `Quality score ${review.score} is below minimum ${minQuality}`,
    );
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

  return { allowed: reasons.length === 0, reasons };
}
