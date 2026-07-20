import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import { requireDocsAdmin } from "./admin-docs";

const ADMIN = "admin-user-1";
const env = (ids: string | undefined) => ({ SKILLIST_ADMIN_USER_IDS: ids }) as unknown as Env;
const auth = (over: Partial<AuthContext>): AuthContext => ({
  userId: null,
  apiKeyId: null,
  apiKeyOrgId: null,
  apiKeyCreatedBy: null,
  apiKeyScopes: [],
  ...over,
});

describe("requireDocsAdmin", () => {
  it("allows an admin session user", () => {
    expect(requireDocsAdmin(env(ADMIN), auth({ userId: ADMIN }))).toMatchObject({ ok: true });
  });

  it("allows an admin-created API key carrying admin:docs (the CLI path)", () => {
    // authMiddleware always sets apiKeyId alongside apiKeyCreatedBy, so a
    // realistic key fixture must include it.
    const key = auth({
      apiKeyId: "key-1",
      apiKeyCreatedBy: ADMIN,
      apiKeyScopes: ["admin:docs"],
    });
    expect(requireDocsAdmin(env(`x,${ADMIN},y`), key)).toMatchObject({ ok: true });
  });

  it("rejects an admin-created API key that lacks admin:docs", () => {
    // The escalation this gate exists to prevent: any key an admin had ever
    // minted (e.g. a skills:read key for CI) previously conferred full
    // platform-admin purely because its creator was an admin.
    const readOnlyKey = auth({
      apiKeyId: "key-2",
      apiKeyCreatedBy: ADMIN,
      apiKeyScopes: ["skills:read"],
    });
    expect(requireDocsAdmin(env(ADMIN), readOnlyKey)).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a non-admin's key even when it claims admin:docs", () => {
    // Scope alone is never sufficient — the creator must also be allow-listed.
    const forgedScope = auth({
      apiKeyId: "key-3",
      apiKeyCreatedBy: "someone-else",
      apiKeyScopes: ["admin:docs"],
    });
    expect(requireDocsAdmin(env(ADMIN), forgedScope)).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a non-admin session with 403", () => {
    expect(requireDocsAdmin(env(ADMIN), auth({ userId: "someone-else" }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("rejects an unauthenticated caller with 401", () => {
    expect(requireDocsAdmin(env(ADMIN), auth({}))).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed with 403 when no admin ids are configured", () => {
    expect(requireDocsAdmin(env(undefined), auth({ userId: ADMIN }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
