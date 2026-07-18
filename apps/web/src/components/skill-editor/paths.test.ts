import { describe, expect, it } from "vitest";
import { buildTree, isAllowedPath, isProtectedPath, isTextPath, pathsUnder } from "./paths";

describe("isAllowedPath", () => {
  it("allows spec root files", () => {
    expect(isAllowedPath("SKILL.md")).toBe(true);
    expect(isAllowedPath("plugin.json")).toBe(true);
  });

  it("allows files under scripts/, references/, assets/", () => {
    expect(isAllowedPath("scripts/run.py")).toBe(true);
    expect(isAllowedPath("references/deep/notes.md")).toBe(true);
    expect(isAllowedPath("assets/data.csv")).toBe(true);
  });

  it("rejects other root files and dirs", () => {
    expect(isAllowedPath("README.md")).toBe(false);
    expect(isAllowedPath("lib/util.py")).toBe(false);
    expect(isAllowedPath("scripts")).toBe(false);
  });

  it("rejects traversal, absolute paths, bad segments", () => {
    expect(isAllowedPath("scripts/../secret")).toBe(false);
    expect(isAllowedPath("/scripts/run.py")).toBe(false);
    expect(isAllowedPath("scripts/spaced name.py")).toBe(false);
    expect(isAllowedPath("scripts//double.py")).toBe(false);
  });
});

describe("isProtectedPath / isTextPath", () => {
  it("protects only SKILL.md", () => {
    expect(isProtectedPath("SKILL.md")).toBe(true);
    expect(isProtectedPath("plugin.json")).toBe(false);
  });

  it("recognizes text extensions", () => {
    expect(isTextPath("scripts/run.py")).toBe(true);
    expect(isTextPath("assets/logo.png")).toBe(false);
  });
});

describe("pathsUnder", () => {
  it("collects only paths under the prefix", () => {
    const files = {
      "SKILL.md": "",
      "scripts/a.py": "",
      "scripts/lib/b.py": "",
      "references/c.md": "",
    };
    expect(pathsUnder(files, "scripts").sort()).toEqual(["scripts/a.py", "scripts/lib/b.py"]);
    expect(pathsUnder(files, "script")).toEqual([]);
  });
});

describe("buildTree", () => {
  it("pins SKILL.md first, then files, then dirs alphabetically", () => {
    const tree = buildTree({
      "references/notes.md": "",
      "SKILL.md": "",
      "plugin.json": "",
      "scripts/run.py": "",
    });
    expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "plugin.json", "references", "scripts"]);
    expect(tree[3]?.children?.map((n) => n.path)).toEqual(["scripts/run.py"]);
  });

  it("includes pending empty dirs", () => {
    const tree = buildTree({ "SKILL.md": "" }, ["assets"]);
    expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "assets"]);
    expect(tree[1]?.children).toEqual([]);
  });
});
