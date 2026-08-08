import { describe, expect, it } from "vitest";

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.io";

/**
 * Post-deploy checks for the authenticated dashboard endpoints the console's
 * pages are built on.
 *
 * These exist because the smoke suite went green while `/observability` was
 * returning 500 in production for every org: a migration had merged to main and
 * shipped a Worker that queried a column the production database did not have.
 * Nothing in the gate touched an authenticated endpoint, so nothing noticed.
 *
 * A 500 here means the deployed Worker disagrees with the deployed schema.
 */
describe.skipIf(!process.env.SKILLIST_E2E_API_KEY)("authenticated dashboard smoke", () => {
  const auth = { Authorization: `Bearer ${process.env.SKILLIST_E2E_API_KEY ?? ""}` };

  async function firstOrgId(): Promise<string> {
    const res = await fetch(`${API_URL}/v1/orgs`, { headers: auth });
    expect(res.ok).toBe(true);
    const [org] = (await res.json()) as { id: string }[];
    if (!org) throw new Error("no organizations returned — cannot smoke-test org endpoints");
    return org.id;
  }

  it("serves the observability dashboard", async () => {
    const orgId = await firstOrgId();
    const res = await fetch(`${API_URL}/v1/orgs/${orgId}/observability?days=30`, {
      headers: auth,
    });

    // Asserted before .ok so a failure names the status rather than "false".
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      telemetry?: { byHarness?: unknown };
      runs?: unknown;
      series?: unknown;
    };
    expect(body.runs).toBeDefined();
    expect(body.series).toBeDefined();
    // Every field the console reads without a guard must actually be present.
    expect(Array.isArray(body.telemetry?.byHarness)).toBe(true);
  });

  it("serves the org telemetry summary", async () => {
    const orgId = await firstOrgId();
    const res = await fetch(`${API_URL}/v1/orgs/${orgId}/telemetry?days=30`, { headers: auth });
    expect(res.status).toBe(200);
  });

  it("serves org coverage", async () => {
    const orgId = await firstOrgId();
    const res = await fetch(`${API_URL}/v1/orgs/${orgId}/coverage`, { headers: auth });
    expect(res.status).toBe(200);
  });
});
