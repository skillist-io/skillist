import { describe, expect, it } from "vitest";
import { errorLinesForSkillMd } from "./frontmatter-lines";

const CONTENT = "---\nname: Bad Name\ndescription: ok\ncompatibility: x\n---\nbody";

describe("errorLinesForSkillMd", () => {
  it("maps frontmatter field errors to their yaml line", () => {
    const lines = errorLinesForSkillMd(CONTENT, [
      { path: "frontmatter.name", message: "invalid" },
      { path: "frontmatter.compatibility", message: "too long" },
    ]);
    expect([...lines].sort()).toEqual([2, 4]);
  });

  it("anchors structural and unmatched errors to line 1", () => {
    const lines = errorLinesForSkillMd(CONTENT, [
      { path: "SKILL.md", message: "missing frontmatter" },
      { path: "frontmatter.license", message: "nope" },
    ]);
    expect([...lines]).toEqual([1]);
  });

  it("ignores file-path errors", () => {
    const lines = errorLinesForSkillMd(CONTENT, [{ path: "lib/x.py", message: "unexpected" }]);
    expect(lines.size).toBe(0);
  });
});
