import { describe, expect, it } from "vitest";
import { DEFAULT_ROOTS, discoverSkillsFromTree, listSkillFileEntries } from "./discover";
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
    { path: "docs/guide/SKILL.md", type: "blob", sha: "h" },
  ];

  it("finds skills under skills/ including nested folders", () => {
    const found = discoverSkillsFromTree(tree, ["skills"]);
    expect(found.map((s) => s.skillSlug)).toEqual([
      "agents-sdk",
      "local-tool",
      "too-deep",
      "wrangler",
    ]);
    expect(found.find((s) => s.skillSlug === "agents-sdk")?.sourcePath).toBe("skills/agents-sdk");
  });

  it("finds nested plugin skills", () => {
    const nested: GithubTreeEntry[] = [
      {
        path: "plugins/adobe-analytics/skills/aa-kpi-pulse/SKILL.md",
        type: "blob",
        sha: "1",
      },
      {
        path: "plugins/aws-foo/skills/analyzing-release-readiness/SKILL.md",
        type: "blob",
        sha: "2",
      },
    ];
    const found = discoverSkillsFromTree(nested, ["skills"]);
    expect(found.map((s) => s.skillSlug).sort()).toEqual([
      "aa-kpi-pulse",
      "analyzing-release-readiness",
    ]);
  });

  it("ignores SKILL.md outside skills roots", () => {
    const found = discoverSkillsFromTree(tree, ["skills"]);
    expect(found.some((s) => s.sourcePath.startsWith("docs/"))).toBe(false);
  });

  it("discovers every canonical root via DEFAULT_ROOTS (matches the CLI scanner)", () => {
    const multiRoot: GithubTreeEntry[] = [
      { path: ".cursor/skills/cursor-tool/SKILL.md", type: "blob", sha: "1" },
      { path: ".claude/skills/claude-tool/SKILL.md", type: "blob", sha: "2" },
      { path: ".gemini/skills/gemini-tool/SKILL.md", type: "blob", sha: "3" },
      { path: ".codex/skills/codex-tool/SKILL.md", type: "blob", sha: "4" },
      { path: ".agents/skills/agents-tool/SKILL.md", type: "blob", sha: "5" },
      { path: ".vscode/skills/vscode-tool/SKILL.md", type: "blob", sha: "6" },
      {
        path: ".claude/plugins/marketplaces/acme/plugins/foo/skills/market-tool/SKILL.md",
        type: "blob",
        sha: "7",
      },
      { path: "skills/plain-tool/SKILL.md", type: "blob", sha: "8" },
    ];
    const found = discoverSkillsFromTree(multiRoot, DEFAULT_ROOTS);
    expect(found.map((s) => s.skillSlug).sort()).toEqual([
      "agents-tool",
      "claude-tool",
      "codex-tool",
      "cursor-tool",
      "gemini-tool",
      "market-tool",
      "plain-tool",
      "vscode-tool",
    ]);
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
