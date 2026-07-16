import { describe, expect, it } from "vitest";
import { evaluatePublishPolicy } from "./publish-policy";

const baseReview = { score: 80, checks: [] };
const passSecurity = { status: "pass" as const, issues: [] };

describe("evaluatePublishPolicy", () => {
  it("blocks publish when eval uplift is below minimum", () => {
    const result = evaluatePublishPolicy({ minEvalUplift: 5 }, baseReview, passSecurity, {
      status: "completed",
      uplift: 2,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("below minimum");
  });

  it("requires completed eval when requireEval is set", () => {
    const result = evaluatePublishPolicy({ requireEval: true }, baseReview, passSecurity, null);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("completed eval");
  });
});
