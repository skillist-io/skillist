import { describe, expect, it } from "vitest";
import { isSameSitePath } from "./auth-client";

// Regression for the open-redirect fix (M7): a ?redirect= param is
// attacker-controllable, so only genuine same-site paths may pass through to a
// post-auth navigation. Everything else must be rejected so sign-in can't
// bounce a victim to an external phishing origin.
describe("isSameSitePath", () => {
  it("accepts plain same-site absolute paths", () => {
    for (const path of ["/", "/dashboard", "/orgs/abc/settings", "/login?next=/x", "/a#b"]) {
      expect(isSameSitePath(path)).toBe(true);
    }
  });

  it("rejects absolute URLs", () => {
    for (const path of ["https://evil.example/x", "http://evil.example", "HTTPS://evil"]) {
      expect(isSameSitePath(path)).toBe(false);
    }
  });

  it("rejects protocol-relative and backslash host-confusion", () => {
    for (const path of ["//evil.example", "/\\evil.example", "/%2F%2Fevil", "/%5Cevil"]) {
      expect(isSameSitePath(path)).toBe(false);
    }
  });

  it("rejects non-rooted paths and non-strings", () => {
    for (const path of ["dashboard", "javascript:alert(1)", "", "  /x"]) {
      expect(isSameSitePath(path)).toBe(false);
    }
    expect(isSameSitePath(undefined as unknown as string)).toBe(false);
  });
});
