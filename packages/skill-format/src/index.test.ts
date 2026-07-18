import { describe, expect, it } from "vitest";
import { encodeBase64 } from "./binary";
import {
  createSkillTemplate,
  estimateImpactScore,
  extractAgentDiscovery,
  extractRegistryDiscovery,
  parsePluginManifest,
  parseSkillMd,
  reviewSkillBundle,
  scanSkillSecurity,
  serializeSkillMd,
  updateSkillMdFrontmatter,
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
    expect(validateSkillName("other", "pdf-processing").length).toBeGreaterThan(0);
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

  it("handles a description containing a colon (regression: the API's default 'Agent skill: <name>' text)", () => {
    const bundle = createSkillTemplate("my-skill", "Agent skill: my skill");
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.frontmatter.description).toBe("Agent skill: my skill");
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
    const bundle = createSkillTemplate(
      "my-skill",
      "A skill with plugin manifest for editor integration.",
    );
    bundle.set("plugin.json", JSON.stringify({ name: "my-skill", skills: ["SKILL.md"] }));
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(true);
  });

  it("allows a valid binary asset under assets/", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with a logo asset.");
    bundle.set("assets/logo.png", encodeBase64(new Uint8Array([137, 80, 78, 71])));
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(true);
  });

  it("rejects a binary asset outside assets/", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with a misplaced asset.");
    bundle.set("scripts/logo.png", encodeBase64(new Uint8Array([1, 2, 3])));
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContainEqual({
        path: "scripts/logo.png",
        message: "binary assets (images, PDFs, archives) must live under assets/",
      });
    }
  });

  it("rejects invalid base64 content for a binary asset", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with a corrupt asset.");
    bundle.set("assets/logo.png", "not valid base64!!");
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("valid base64"))).toBe(true);
    }
  });

  it("rejects a binary asset over the size limit", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with an oversized asset.");
    bundle.set("assets/huge.png", encodeBase64(new Uint8Array(6 * 1024 * 1024)));
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("exceeds the 5MB limit"))).toBe(true);
    }
  });

  it("rejects a path-traversal file path instead of silently skipping it", () => {
    const bundle = createSkillTemplate("my-skill", "A skill that tries to escape /workspace.");
    bundle.set("../../etc/cron.d/evil", "* * * * * root sh");
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "../../etc/cron.d/evil")).toBe(true);
    }
  });

  it("rejects an absolute file path", () => {
    const bundle = createSkillTemplate("my-skill", "A skill with an absolute path.");
    bundle.set("/etc/passwd", "root:x:0:0");
    const result = validateSkillBundle(bundle, "my-skill");
    expect(result.valid).toBe(false);
  });
});

describe("parseSkillMd", () => {
  it("splits yaml text, parsed frontmatter, and body", () => {
    const content = "---\nname: roll-dice\ndescription: Roll dice.\n---\n# Body\n";
    const parsed = parseSkillMd(content);
    expect(parsed).not.toBeNull();
    expect(parsed?.yamlText).toBe("name: roll-dice\ndescription: Roll dice.");
    expect(parsed?.frontmatter).toEqual({ name: "roll-dice", description: "Roll dice." });
    expect(parsed?.body).toBe("# Body\n");
  });

  it("handles CRLF fences", () => {
    const content = "---\r\nname: roll-dice\r\ndescription: Roll dice.\r\n---\r\n# Body";
    const parsed = parseSkillMd(content);
    expect(parsed?.body).toBe("# Body");
  });

  it("returns null on missing fences or invalid yaml", () => {
    expect(parseSkillMd("# no frontmatter")).toBeNull();
    expect(parseSkillMd("---\n: [broken\n---\nbody")).toBeNull();
  });
});

describe("serializeSkillMd", () => {
  it("round-trips through parseSkillMd with stable key order", () => {
    const fm = {
      "allowed-tools": "Bash Read",
      description: "Roll dice.",
      metadata: { author: "skillist" },
      name: "roll-dice",
    };
    const content = serializeSkillMd(fm, "# Body\n");
    expect(content).toBe(
      "---\nname: roll-dice\ndescription: Roll dice.\nmetadata:\n  author: skillist\nallowed-tools: Bash Read\n---\n# Body\n",
    );
    const parsed = parseSkillMd(content);
    expect(parsed?.frontmatter).toEqual(fm);
    expect(parsed?.body).toBe("# Body\n");
  });

  it("does not fold long scalar values across lines", () => {
    const description =
      "Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.";
    const content = serializeSkillMd({ name: "pdf-tools", description }, "");
    expect(content).toBe(`---\nname: pdf-tools\ndescription: ${description}\n---\n`);
    expect(parseSkillMd(content)?.frontmatter).toEqual({ name: "pdf-tools", description });
  });

  it("omits undefined optional fields", () => {
    const content = serializeSkillMd({ name: "a", description: "b", license: undefined }, "");
    expect(content).toBe("---\nname: a\ndescription: b\n---\n");
  });
});

describe("updateSkillMdFrontmatter", () => {
  it("keeps the body byte-identical", () => {
    const body = "# Title\n\n```py\nx = 1\n```\n\ntrailing  spaces  \n";
    const content = serializeSkillMd({ name: "a", description: "b" }, body);
    const updated = updateSkillMdFrontmatter(content, { name: "a", description: "changed" });
    expect(parseSkillMd(updated)?.body).toBe(body);
    expect(parseSkillMd(updated)?.frontmatter).toEqual({ name: "a", description: "changed" });
  });

  it("drops yaml comments on regeneration", () => {
    const content = "---\n# a comment\nname: a\ndescription: b\n---\nbody";
    const updated = updateSkillMdFrontmatter(content, { name: "a", description: "b" });
    expect(updated).not.toContain("# a comment");
    expect(parseSkillMd(updated)?.body).toBe("body");
  });

  it("wraps content lacking frontmatter", () => {
    const updated = updateSkillMdFrontmatter("just a body", { name: "a", description: "b" });
    expect(parseSkillMd(updated)?.body).toBe("just a body");
  });
});

describe("reviewSkillBundle", () => {
  it("scores a valid template", () => {
    const bundle = createSkillTemplate(
      "roll-dice",
      "Roll dice when asked for random numbers in chat.",
    );
    const review = reviewSkillBundle(bundle, "roll-dice");
    expect(review.score).toBeGreaterThan(0);
    expect(review.checks.some((c) => c.id === "valid-bundle" && c.passed)).toBe(true);
  });

  it("estimates impact from review", () => {
    const bundle = createSkillTemplate(
      "roll-dice",
      "Roll dice when asked for random numbers in chat.",
    );
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

describe("extractAgentDiscovery", () => {
  it("extracts declared agents from plugin.json", () => {
    const manifest = parsePluginManifest(
      JSON.stringify({
        name: "my-plugin",
        skills: ["SKILL.md"],
        agents: ["cursor", "Claude", "custom-agent"],
      }),
    );
    const agents = extractAgentDiscovery(manifest);
    expect(agents).toContain("cursor");
    expect(agents).toContain("claude");
    expect(agents).toContain("custom-agent");
  });

  it("adds mcp when servers are declared", () => {
    const manifest = parsePluginManifest(
      JSON.stringify({
        name: "mcp-plugin",
        skills: ["SKILL.md"],
        mcp: { servers: [{ name: "tools", url: "https://example.com/mcp" }] },
      }),
    );
    expect(extractAgentDiscovery(manifest)).toContain("mcp");
  });
});

describe("extractRegistryDiscovery", () => {
  it("extracts category and tags from metadata", () => {
    const result = extractRegistryDiscovery({
      name: "test-skill",
      description: "A test skill",
      metadata: {
        category: "performance",
        level: "mid",
        tags: "audit, web",
      },
    });
    expect(result.category).toBe("performance");
    expect(result.tags).toContain("performance");
    expect(result.tags).toContain("mid");
    expect(result.tags).toContain("audit");
    expect(result.tags).toContain("web");
  });
});
