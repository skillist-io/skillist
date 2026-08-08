import { describe, expect, it } from "vitest";

/**
 * Guard against the failure mode that has bitten this repo three times: a
 * missing input silently degrades into a skipped test, and the job still
 * reports success.
 *
 * `SKILLIST_E2E_API_KEY` gates every authenticated smoke test. When it is
 * absent those suites skip, `smoke` goes green, and nothing has actually been
 * checked against production — which is how a 500 on the console's
 * Observability page survived a fully green pipeline.
 *
 * Locally that skip is correct: most contributors have no production
 * credentials and should not be blocked. In CI it is never correct, so this
 * asserts the credential is present rather than letting the absence pass
 * quietly. It runs only in CI for exactly that reason.
 */
describe.runIf(process.env.CI)("smoke credentials (CI only)", () => {
  it("SKILLIST_E2E_API_KEY is configured", () => {
    expect(
      process.env.SKILLIST_E2E_API_KEY,
      "SKILLIST_E2E_API_KEY is not set. The authenticated smoke tests would skip and this job would still pass, leaving production unverified. Add it as a REPOSITORY secret.",
    ).toBeTruthy();
  });
});
