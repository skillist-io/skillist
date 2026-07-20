import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Account deletion has gates that are easy to regress silently, so they are
 * asserted rather than only reasoned about.
 *
 * The assertions below read the served OpenAPI document, which needs no
 * database. Exercising the handler itself requires one — every /v1 request goes
 * through authMiddleware, which opens a connection — so those cases are skipped
 * here in the same way routes/projects.test.ts skips its DB-dependent block.
 */
describe("DELETE /v1/account contract", () => {
  async function deleteAccountOp() {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { description?: string; operationId?: string; responses?: object }>
      >;
    };
    return doc.paths["/v1/account"]?.delete;
  }

  it("is registered", async () => {
    expect((await deleteAccountOp())?.operationId).toBe("deleteAccount");
  });

  it("documents that it is session-only", async () => {
    // An API key must not delete the human who created it, and that has to be
    // discoverable from the reference, not only enforced in code.
    expect((await deleteAccountOp())?.description).toMatch(/session/i);
  });

  it("documents the sole-owner rule", async () => {
    const description = (await deleteAccountOp())?.description ?? "";
    expect(description).toMatch(/sole owner/i);
  });

  it("declares the 409 that prevents orphaning an org", async () => {
    // Deleting the only owner of an org with other members would leave its
    // skills and keys with nobody able to administer them.
    const responses = (await deleteAccountOp())?.responses as Record<string, unknown>;
    expect(responses["409"]).toBeDefined();
  });

  it("declares 401 and 403", async () => {
    const responses = (await deleteAccountOp())?.responses as Record<string, unknown>;
    expect(responses["401"]).toBeDefined();
    expect(responses["403"]).toBeDefined();
  });
});

// Needs a live database: authMiddleware opens a connection on every /v1
// request, so these cannot run against the placeholder Hyperdrive binding.
describe.skip("DELETE /v1/account behaviour (requires DB)", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    const res = await SELF.fetch("http://localhost/v1/account", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("rejects an API key with 403 even when the key is valid", async () => {
    // The key's creator is a human whose account it must not be able to delete.
  });

  it("blocks with 409 when the caller is the sole owner of a shared org", async () => {});

  it("deletes an org where the caller is the only member", async () => {});

  it("keeps the audit event after the user row is gone", async () => {
    // audit_events.actor_id is plain text with no FK precisely so the record of
    // privileged actions outlives the account.
  });
});
