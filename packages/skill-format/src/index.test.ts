import { describe, expect, it } from "vitest";
import {
  createSkillTemplate,
  validateSkillBundle,
  validateSkillName,
} from "./index";

describe("validateSkillName", () => {
  it("accepts valid names", () => {
    expect(validateSkillName("pdf-processing", "pdf-processing")).toEqual([]);
  });

  it("rejects uppercase", () => {
    expect(validateSkillName("PDF-processing").length).toBeGreaterThan(0);
  });

  it("rejects slug mismatch", () => {
    expect(validateSkillName("other", "pdf-processing").length).toBeGreaterThan(
      0,
    );
  });
});

describe("validateSkillBundle", () => {
  it("validates a minimal skill", () => {
    const bundle = createSkillTemplate("roll-dice", "Roll dice when asked.");
    const result = validateSkillBundle(bundle, "roll-dice");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.frontmatter.name).toBe("roll-dice");
    }
  });

  it("requires SKILL.md", () => {
    const result = validateSkillBundle(new Map());
    expect(result.valid).toBe(false);
  });

  it("rejects missing frontmatter", () => {
    const bundle = new Map([["SKILL.md", "# No frontmatter"]]);
    const result = validateSkillBundle(bundle);
    expect(result.valid).toBe(false);
  });
});
