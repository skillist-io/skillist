import { describe, expect, it } from "vitest";
import { highlight, languageForFence, languageForPath } from "./highlight";

describe("languageForPath", () => {
  it("maps extensions", () => {
    expect(languageForPath("SKILL.md")).toBe("markdown");
    expect(languageForPath("scripts/run.py")).toBe("python");
    expect(languageForPath("scripts/build.sh")).toBe("shell");
    expect(languageForPath("plugin.json")).toBe("json");
    expect(languageForPath("assets/data.csv")).toBe("plain");
  });
});

describe("languageForFence", () => {
  it("maps common fence info strings, case-insensitively", () => {
    expect(languageForFence("py")).toBe("python");
    expect(languageForFence("Python")).toBe("python");
    expect(languageForFence("bash")).toBe("shell");
    expect(languageForFence("ts")).toBe("javascript");
    expect(languageForFence("yml")).toBe("yaml");
  });

  it("falls back to plain for unknown or missing info strings", () => {
    expect(languageForFence("rust")).toBe("plain");
    expect(languageForFence(undefined)).toBe("plain");
  });
});

describe("highlight", () => {
  it("always escapes HTML in every language", () => {
    for (const lang of [
      "markdown",
      "yaml",
      "python",
      "shell",
      "javascript",
      "json",
      "plain",
    ] as const) {
      const out = highlight('<script>alert("&")</script>', lang);
      expect(out).not.toContain("<script>");
      expect(out).toContain("&lt;");
    }
  });

  it("highlights frontmatter fences and yaml keys in markdown", () => {
    const out = highlight("---\nname: roll-dice\n---\n# Title\n", "markdown");
    const lines = out.split("\n");
    expect(lines[0]).toContain("tok-fence");
    expect(lines[1]).toContain("tok-property");
    expect(lines[2]).toContain("tok-fence");
    expect(lines[3]).toContain("tok-heading");
  });

  it("treats code-fence interiors as plain and closes them", () => {
    const out = highlight("```py\nx = 1\n```\n# Head", "markdown");
    const lines = out.split("\n");
    expect(lines[1]).not.toContain("tok-");
    expect(lines[3]).toContain("tok-heading");
  });

  it("keeps line count identical to input", () => {
    const input = "a\n\nb\nc\n";
    for (const lang of ["markdown", "yaml", "python", "javascript"] as const) {
      expect(highlight(input, lang).split("\n").length).toBe(input.split("\n").length);
    }
  });

  it("tracks python triple-quote strings across lines", () => {
    const out = highlight('x = """\ninside # not a comment\n"""\ny = 1', "python");
    const lines = out.split("\n");
    expect(lines[1]).toContain("tok-string");
    expect(lines[1]).not.toContain("tok-comment");
    expect(lines[3]).toContain("tok-number");
  });

  it("does not open triple-quote state for self-closed docstrings", () => {
    const out = highlight('x = """doc"""\ny = 2', "python");
    expect(out.split("\n")[1]).toContain("tok-number");
  });

  it("highlights json keys distinctly from string values", () => {
    const out = highlight('{"name": "value"}', "json");
    expect(out).toContain("tok-property");
    expect(out).toContain("tok-string");
  });
});
