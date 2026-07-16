import { describe, expect, it } from "vitest";
import { bumpSemver, resolveNextSemver } from "./semver";

describe("semver", () => {
  it("bumps patch by default", () => {
    expect(bumpSemver("1.2.3")).toBe("1.2.4");
  });

  it("bumps minor and major", () => {
    expect(bumpSemver("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
  });

  it("resolves explicit semver or bump from parent", () => {
    expect(resolveNextSemver("2.0.0", { bump: "minor" })).toBe("2.1.0");
    expect(resolveNextSemver("2.0.0", { semver: "3.0.0" })).toBe("3.0.0");
    expect(resolveNextSemver(null, {})).toBe("0.1.0");
  });
});
