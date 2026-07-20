import { describe, expect, it } from "vitest";
import { extractRegistryDiscovery, validateSkillBundle } from "./index";

/**
 * Executes the README's usage example verbatim.
 *
 * The previous example was published to npm and did not work: it passed raw
 * markdown to extractRegistryDiscovery (which takes parsed frontmatter), and
 * its sample bundle omitted the required `description`, so validation failed.
 * Keeping the example under test means the package's front door cannot rot
 * again without a build failure.
 */
describe("README example", () => {
  const bundle = new Map([
    [
      "SKILL.md",
      `---
name: my-skill
description: Audits a codebase and reports findings.
metadata:
  category: quality
  tags: audit, review
---
# My Skill

Instructions for the agent go here.`,
    ],
  ]);

  it("validates the documented sample bundle", () => {
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("extracts discovery metadata from the parsed frontmatter", () => {
    const result = validateSkillBundle(bundle, "my-skill");
    if (!result.valid) throw new Error("fixture should validate");

    const { category, tags } = extractRegistryDiscovery(result.frontmatter);
    expect(category).toBe("quality");
    // `tags` is the full searchable set: category and level are folded in
    // alongside the explicit tags, which is what the README documents.
    expect(tags).toEqual(["quality", "audit", "review"]);
  });
});
