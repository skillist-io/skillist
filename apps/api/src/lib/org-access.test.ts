import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { requireOrgAccess } from "./org-access";

const ORG = "11111111-1111-4111-8111-111111111111";

/** The API-key branch never touches the database, so a stub suffices. */
const db = {} as WorkerDb;

function apiKeyAuth(scopes: string[], orgId: string = ORG): AuthContext {
  return {
    userId: null,
    apiKeyId: "key-1",
    apiKeyOrgId: orgId,
    apiKeyCreatedBy: "user-1",
    apiKeyScopes: scopes,
  };
}

describe("requireOrgAccess with an API key", () => {
  it("clears an editor minimum when the route names skills:write", async () => {
    // `POST /v1/orgs/{orgId}/skills` — reached by `skillist push`.
    const access = await requireOrgAccess(db, ORG, apiKeyAuth(["skills:write"]), "editor", {
      apiKeyScope: "skills:write",
    });
    expect(access).toMatchObject({ ok: true, role: "editor", actorType: "api_key" });
  });

  it("clears a publisher minimum when the route names skills:write", async () => {
    // `POST /v1/orgs/{orgId}/inventory/scan` — reached by `skillist inventory scan`.
    const access = await requireOrgAccess(db, ORG, apiKeyAuth(["skills:write"]), "publisher", {
      apiKeyScope: "skills:write",
    });
    expect(access).toMatchObject({ ok: true, role: "editor" });
  });

  it("rejects every API key on a route that names no scope, however privileged the key", async () => {
    // The trap this documents: the effective role comes from the scope the ROUTE
    // names, not the scopes the KEY holds. Unnamed means viewer, so any higher
    // minimum rejects all keys. Routes meant to be console-only rely on this.
    const allScopes = ["skills:read", "skills:write", "skills:publish", "feedback:approve"];
    for (const minRole of ["publisher", "editor", "owner"] as const) {
      const access = await requireOrgAccess(db, ORG, apiKeyAuth(allScopes), minRole);
      expect(access).toEqual({ ok: false, status: 403 });
    }
  });

  it("still allows a viewer-minimum route with no scope named", async () => {
    const access = await requireOrgAccess(db, ORG, apiKeyAuth([]), "viewer");
    expect(access).toMatchObject({ ok: true, role: "viewer" });
  });

  it("rejects a key scoped to a different org", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const access = await requireOrgAccess(db, ORG, apiKeyAuth(["skills:write"], other), "editor", {
      apiKeyScope: "skills:write",
    });
    expect(access).toEqual({ ok: false, status: 403 });
  });

  it("rejects a key that lacks the scope the route names", async () => {
    const access = await requireOrgAccess(db, ORG, apiKeyAuth(["skills:read"]), "editor", {
      apiKeyScope: "skills:write",
    });
    expect(access).toEqual({ ok: false, status: 403 });
  });

  it("rejects an unauthenticated caller with 401, not 403", async () => {
    const anon: AuthContext = {
      userId: null,
      apiKeyId: null,
      apiKeyOrgId: null,
      apiKeyCreatedBy: null,
      apiKeyScopes: [],
    };
    expect(await requireOrgAccess(db, ORG, anon, "viewer")).toEqual({ ok: false, status: 401 });
  });
});
