import { describe, expect, it } from "vitest";
import { sanitizeMirrorBundle } from "./bundle";
import { assertMirrorLicenseAllowed, isCompatibleLicense } from "./fetch";

describe("sanitizeMirrorBundle", () => {
  it("keeps agentskills paths and drops extras", () => {
    const bundle = new Map([
      ["SKILL.md", "---\nname: x\ndescription: y\n---\n"],
      ["references/a.md", "a"],
      ["examples/foo.md", "nope"],
      ["LICENSE", "Apache"],
      ["plugin.json", "{}"],
    ]);
    const cleaned = sanitizeMirrorBundle(bundle);
    expect([...cleaned.keys()].sort()).toEqual(["SKILL.md", "plugin.json", "references/a.md"]);
  });
});

describe("assertMirrorLicenseAllowed", () => {
  it("allows missing license for official_mirror", () => {
    expect(() => assertMirrorLicenseAllowed(null, "official_mirror")).not.toThrow();
  });

  it("rejects incompatible SPDX", () => {
    expect(() => assertMirrorLicenseAllowed("GPL-3.0", "official_mirror")).toThrow(/Incompatible/);
  });

  it("accepts MIT", () => {
    expect(isCompatibleLicense("MIT")).toBe(true);
  });
});
