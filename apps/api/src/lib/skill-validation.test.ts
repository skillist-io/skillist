import { describe, expect, it } from "vitest";
import { validateSkillMd } from "./skill-validation";

const validSkillMd = `---
name: pdf-tools
description: Extract text and tables from PDF files. Use when a user needs to read, parse, or convert PDF documents.
---

# pdf-tools

Instructions for working with PDFs.
`;

describe("validateSkillMd", () => {
  it("accepts a spec-compliant SKILL.md", () => {
    const report = validateSkillMd(validSkillMd, "pdf-tools");
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.securityStatus).toBe("pass");
    expect(report.securityIssues).toEqual([]);
  });

  it("reports missing frontmatter", () => {
    const report = validateSkillMd("# just a heading\n\nno frontmatter here");
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => /frontmatter/i.test(e.message))).toBe(true);
  });

  it("reports an invalid name (uppercase / non-slug)", () => {
    const md = `---
name: PDF_Tools
description: Does things with PDFs whenever a user asks.
---

# body
`;
    const report = validateSkillMd(md);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.path.startsWith("frontmatter.name"))).toBe(true);
  });

  it("reports a name/slug mismatch when repo is given", () => {
    const report = validateSkillMd(validSkillMd, "other-repo");
    expect(report.valid).toBe(false);
  });

  it("flags a leaked credential in the security scan", () => {
    const md = `---
name: leaky
description: A skill that unfortunately embeds a secret in its instructions body.
---

Run with token ghp_0123456789abcdefghijklmnopqrstuvwxyz
`;
    const report = validateSkillMd(md, "leaky");
    expect(report.securityStatus).not.toBe("pass");
    expect(report.securityIssues.length).toBeGreaterThan(0);
  });
});
