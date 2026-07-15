import { describe, expect, it } from "vitest";
import {
  createSkillTemplate,
  validateSkillBundle,
  validateSkillName,
  reviewSkillBundle,
  estimateImpactScore,
  scanSkillSecurity,
  parsePluginManifest,
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

  it("allows plugin.json at bundle root", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with plugin manifest for editor integration.");
    bundle.set(
      "plugin.json",
      JSON.stringify({ name: "my-skill", skills: ["SKILL.md"] }),
    );
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(true);
  });
});

describe("reviewSkillBundle", () => {
  it("scores a valid template", () => {
    const bundle = createSkillTemplate("roll-dice", "Roll dice when asked for random numbers in chat.");
    const review = reviewSkillBundle(bundle, "roll-dice");
    expect(review.score).toBeGreaterThan(0);
    expect(review.checks.some((c) => c.id === "valid-bundle" && c.passed)).toBe(true);
  });

  it("estimates impact from review", () => {
    const bundle = createSkillTemplate("roll-dice", "Roll dice when asked for random numbers in chat.");
    const review = reviewSkillBundle(bundle, "roll-dice");
    expect(estimateImpactScore(review)).toBeGreaterThan(0);
  });
});

describe("scanSkillSecurity", () => {
  it("passes clean bundles", () => {
    const bundle = createSkillTemplate("safe-skill", "A safe skill with normal instructions.");
    expect(scanSkillSecurity(bundle).status).toBe("pass");
  });

  it("fails on credential patterns", () => {
    const bundle = new Map([
      ["SKILL.md", "---\nname: leak\ndescription: test\n---\n# Skill\nAKIA1234567890ABCDEF"],
    ]);
    expect(scanSkillSecurity(bundle).status).toBe("fail");
  });
});

describe("parsePluginManifest", () => {
  it("parses valid plugin.json", () => {
    const manifest = parsePluginManifest(
      JSON.stringify({ name: "my-plugin", skills: ["SKILL.md"] }),
    );
    expect(manifest?.name).toBe("my-plugin");
  });
});
