import { describe, expect, it } from "vitest";
import type { AuthContext } from "./auth-middleware";

type Visibility = "public" | "private" | "org";

function allowsAnonymousAccess(
  visibility: Visibility,
  auth: Pick<AuthContext, "userId" | "apiKeyId">,
  mode: "run" | "view",
): boolean {
  if (auth.userId || auth.apiKeyId) return true;
  if (visibility !== "public") return false;
  return mode === "view";
}

describe("assertSkillRunAccess rules", () => {
  const anonymous = { userId: null, apiKeyId: null };
  const user = { userId: "user-1", apiKeyId: null };

  it("blocks anonymous sandbox runs on public skills", () => {
    expect(allowsAnonymousAccess("public", anonymous, "run")).toBe(false);
  });

  it("allows anonymous script listing on public skills", () => {
    expect(allowsAnonymousAccess("public", anonymous, "view")).toBe(true);
  });

  it("allows authenticated users to run public skills", () => {
    expect(allowsAnonymousAccess("public", user, "run")).toBe(true);
  });

  it("blocks anonymous access to private skills", () => {
    expect(allowsAnonymousAccess("private", anonymous, "view")).toBe(false);
  });
});
