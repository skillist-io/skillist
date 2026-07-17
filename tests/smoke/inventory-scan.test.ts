import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillItems, parseGitRemoteUrl } from "../../packages/cli/src/inventory.ts";

const skillMd = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n1. Do the thing.\n`;

describe("inventory scan discovery", () => {
  it("parses common GitHub remote URLs", () => {
    expect(parseGitRemoteUrl("git@github.com:skillist/cloudflare-deploy.git")).toBe(
      "skillist/cloudflare-deploy",
    );
    expect(parseGitRemoteUrl("https://github.com/acme/web-app.git")).toBe("acme/web-app");
    expect(parseGitRemoteUrl("https://github.com/acme/web-app")).toBe("acme/web-app");
    expect(parseGitRemoteUrl("not-a-remote")).toBeNull();
  });

  it("discovers SKILL.md files under agent skill roots", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "skillist-inventory-"));
    mkdirSync(path.join(dir, ".cursor/skills/cloudflare-deploy"), { recursive: true });
    writeFileSync(
      path.join(dir, ".cursor/skills/cloudflare-deploy/SKILL.md"),
      skillMd("cloudflare-deploy", "Deploy Workers and related Cloudflare projects."),
    );
    mkdirSync(path.join(dir, ".claude/skills/review"), { recursive: true });
    writeFileSync(
      path.join(dir, ".claude/skills/review/SKILL.md"),
      skillMd("review", "Review pull requests with project conventions."),
    );

    const items = await discoverSkillItems(dir, "skillist/cloudflare-deploy");
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repoFullName: "skillist/cloudflare-deploy",
          filePath: ".cursor/skills/cloudflare-deploy/SKILL.md",
          localSlug: "cloudflare-deploy",
          sourceType: "cursor",
          scope: "project",
          conformanceStatus: "valid",
          isSymlink: false,
        }),
        expect.objectContaining({
          repoFullName: "skillist/cloudflare-deploy",
          filePath: ".claude/skills/review/SKILL.md",
          localSlug: "review",
          sourceType: "claude",
          scope: "project",
          conformanceStatus: "valid",
          isSymlink: false,
        }),
      ]),
    );
    for (const item of items) {
      expect(item.contentHash).toMatch(/^[a-f0-9]{16}$/);
      expect(item.skillMd).toContain("name:");
    }
  });
});
