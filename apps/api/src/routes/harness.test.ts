import { describe, expect, it } from "vitest";
import { harnessRoutes } from "./harness";

const orgId = "00000000-0000-4000-8000-000000000000";
const sessionId = "00000000-0000-4000-8000-000000000001";

describe("harness routes", () => {
  it.each([
    ["POST", `/orgs/${orgId}/harness/sessions`],
    ["POST", `/orgs/${orgId}/harness/sessions/${sessionId}/turns`],
    ["GET", `/orgs/${orgId}/harness/sessions/${sessionId}/events`],
  ])("are closed by default: %s %s", async (method, path) => {
    const res = await harnessRoutes.request(path, { method }, {});
    expect(res.status).toBe(404);
  });

  it("stay closed for any value but the exact flag", async () => {
    const res = await harnessRoutes.request(
      `/orgs/${orgId}/harness/sessions`,
      { method: "POST" },
      { HARNESS_ENABLED: "1" },
    );
    expect(res.status).toBe(404);
  });
});
