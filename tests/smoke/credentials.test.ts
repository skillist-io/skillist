import { describe, expect, it } from "vitest";

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.dev";

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
 *
 * Being set isn't enough either. Moving to D1 started from empty tables, which
 * invalidated the key, and the suites that use it reported only "expected false
 * to be true". So a rejected key gets its own failure that says what to do.
 */
describe.runIf(process.env.CI)("smoke credentials (CI only)", () => {
  it("SKILLIST_E2E_API_KEY is configured", () => {
    expect(
      process.env.SKILLIST_E2E_API_KEY,
      "SKILLIST_E2E_API_KEY is not set. The authenticated smoke tests would skip and this job would still pass, leaving production unverified. Add it as a REPOSITORY secret.",
    ).toBeTruthy();
  });

  it.skipIf(!process.env.SKILLIST_E2E_API_KEY)(
    "SKILLIST_E2E_API_KEY is accepted by production",
    async () => {
      const res = await fetch(`${API_URL}/v1/orgs`, {
        headers: { Authorization: `Bearer ${process.env.SKILLIST_E2E_API_KEY}` },
      });
      expect(
        res.status,
        "Production rejected SKILLIST_E2E_API_KEY, so the authenticated smoke tests below will fail too. Create a new key with skills:read and skills:write, then update the REPOSITORY secret.",
      ).toBe(200);
    },
  );
});
