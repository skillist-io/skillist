import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSkillRoots } from "./scanner.js";

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "skillist-scan-"));
  await mkdir(join(tmp, "skills", "alpha"), { recursive: true });
  await writeFile(
    join(tmp, "skills", "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: A valid alpha skill for testing scanners.\n---\n\n# Alpha\n\n1. Do the thing\n",
  );
  await mkdir(join(tmp, "skills", "nested", "beta"), { recursive: true });
  await writeFile(
    join(tmp, "skills", "nested", "beta", "SKILL.md"),
    "---\nname: beta\ndescription: A nested beta skill for depth testing.\n---\n\n# Beta\n",
  );
  await mkdir(join(tmp, "skills", "alpha", "inner"), { recursive: true });
  await writeFile(
    join(tmp, "skills", "alpha", "inner", "SKILL.md"),
    "---\nname: inner\ndescription: should-not-appear in results.\n---\n",
  );
  await mkdir(join(tmp, "skills", "node_modules", "gamma"), { recursive: true });
  await writeFile(
    join(tmp, "skills", "node_modules", "gamma", "SKILL.md"),
    "---\nname: gamma\ndescription: ignored under node_modules.\n---\n",
  );
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("scanSkillRoots", () => {
  it("finds top-level and nested skills", async () => {
    const skills = await scanSkillRoots([join(tmp, "skills")]);
    const names = skills.map((s) => s.localSlug).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("does not recurse into a discovered skill", async () => {
    const skills = await scanSkillRoots([join(tmp, "skills")]);
    expect(skills.some((s) => s.localSlug === "inner")).toBe(false);
  });

  it("respects hard ignore (node_modules)", async () => {
    const skills = await scanSkillRoots([join(tmp, "skills")]);
    expect(skills.some((s) => s.localSlug === "gamma")).toBe(false);
  });

  it("dedupes by realpath across roots", async () => {
    const linkRoot = join(tmp, "mirror");
    await mkdir(linkRoot, { recursive: true });
    await symlink(join(tmp, "skills", "alpha"), join(linkRoot, "alpha-link"), "dir");
    const skills = await scanSkillRoots([join(tmp, "skills"), linkRoot]);
    expect(skills.filter((s) => s.localSlug === "alpha" || s.contentHash).length).toBeGreaterThan(
      0,
    );
    const alphaHashes = new Set(
      skills.filter((s) => s.skillMd.includes("name: alpha")).map((s) => s.contentHash),
    );
    expect(alphaHashes.size).toBe(1);
  });

  it("respects maxDepth", async () => {
    const skills = await scanSkillRoots([join(tmp, "skills")], { maxDepth: 1 });
    const names = skills.map((s) => s.localSlug);
    expect(names).toContain("alpha");
    expect(names).not.toContain("beta");
  });
});
