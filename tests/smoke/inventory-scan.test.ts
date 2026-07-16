import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillItems, parseGitRemoteUrl } from "../../packages/cli/src/inventory.ts";

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
    writeFileSync(path.join(dir, ".cursor/skills/cloudflare-deploy/SKILL.md"), "# Skill");
    mkdirSync(path.join(dir, ".claude/skills/review"), { recursive: true });
    writeFileSync(path.join(dir, ".claude/skills/review/SKILL.md"), "# Review");

    const items = await discoverSkillItems(dir, "skillist/cloudflare-deploy");
    expect(items).toEqual([
      {
        repoFullName: "skillist/cloudflare-deploy",
        filePath: ".cursor/skills/cloudflare-deploy/SKILL.md",
        localSlug: "cloudflare-deploy",
      },
      {
        repoFullName: "skillist/cloudflare-deploy",
        filePath: ".claude/skills/review/SKILL.md",
        localSlug: "review",
      },
    ]);
  });
});
