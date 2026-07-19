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

  it("allows an API key created by an admin (the CLI path)", () => {
    expect(requireDocsAdmin(env(`x,${ADMIN},y`), auth({ apiKeyCreatedBy: ADMIN }))).toMatchObject({
      ok: true,
    });
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
