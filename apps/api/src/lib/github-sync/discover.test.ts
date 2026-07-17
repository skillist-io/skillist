import { describe, expect, it } from "vitest";
import { discoverSkillsFromTree, listSkillFileEntries } from "./discover";
import type { GithubTreeEntry } from "./fetch";

describe("discoverSkillsFromTree", () => {
  const tree: GithubTreeEntry[] = [
    { path: "skills/agents-sdk/SKILL.md", type: "blob", sha: "a" },
    { path: "skills/agents-sdk/references/rpc.md", type: "blob", sha: "b" },
    { path: "skills/wrangler/SKILL.md", type: "blob", sha: "c" },
    { path: "skills/nested/too-deep/SKILL.md", type: "blob", sha: "d" },
    { path: "README.md", type: "blob", sha: "e" },
    { path: ".cursor/skills/local-tool/SKILL.md", type: "blob", sha: "f" },
    { path: "skills/Bad_Name/SKILL.md", type: "blob", sha: "g" },
  ];

  it("finds one-level skills under configured roots", () => {
    const found = discoverSkillsFromTree(tree, ["skills", ".cursor/skills"]);
    expect(found.map((s) => s.skillSlug)).toEqual(["agents-sdk", "local-tool", "wrangler"]);
    expect(found[0]?.sourcePath).toBe("skills/agents-sdk");
  });

  it("ignores skills outside roots", () => {
    const found = discoverSkillsFromTree(tree, ["skills"]);
    expect(found.some((s) => s.skillSlug === "local-tool")).toBe(false);
  });
});

describe("listSkillFileEntries", () => {
  it("lists relative paths under a skill folder", () => {
    const tree: GithubTreeEntry[] = [
      { path: "skills/agents-sdk/SKILL.md", type: "blob", sha: "a" },
      { path: "skills/agents-sdk/references/rpc.md", type: "blob", sha: "b" },
      { path: "skills/other/SKILL.md", type: "blob", sha: "c" },
    ];
    const files = listSkillFileEntries(tree, "skills/agents-sdk");
    expect(files.map((f) => f.relativePath).sort()).toEqual(["SKILL.md", "references/rpc.md"]);
  });
});
