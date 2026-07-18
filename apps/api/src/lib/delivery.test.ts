import { describe, expect, it } from "vitest";
import { serveSkillMd, serveSkillMeta } from "./delivery";

function stubKv(entries: Record<string, string>): KVNamespace {
  return {
    get: async (key: string) => entries[key] ?? null,
  } as unknown as KVNamespace;
}

const SKILL_MD = "---\nname: x\ndescription: y\n---\nbody";

function metaJson(visibility?: string): string {
  return JSON.stringify({
    name: "x",
    description: "y",
    version: "1.0.0",
    versionId: "v1",
    etag: "etag123",
    org: "acme",
    repo: "widget",
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...(visibility ? { visibility } : {}),
  });
}

const MD_KEY = "skill:acme:widget:latest";
const META_KEY = "skill:acme:widget:meta";

describe("delivery visibility gating (H1)", () => {
  it("serves SKILL.md for a public skill", async () => {
    const kv = stubKv({ [MD_KEY]: SKILL_MD, [META_KEY]: metaJson("public") });
    const res = await serveSkillMd(kv, "acme", "widget");
    expect(res.status).toBe(200);
  });

  it("404s SKILL.md for a private skill", async () => {
    const kv = stubKv({ [MD_KEY]: SKILL_MD, [META_KEY]: metaJson("private") });
    const res = await serveSkillMd(kv, "acme", "widget");
    expect(res.status).toBe(404);
  });

  it("404s SKILL.md when visibility is absent (fails closed for pre-fix cache entries)", async () => {
    const kv = stubKv({ [MD_KEY]: SKILL_MD, [META_KEY]: metaJson(undefined) });
    const res = await serveSkillMd(kv, "acme", "widget");
    expect(res.status).toBe(404);
  });

  it("serves meta for a public skill", async () => {
    const kv = stubKv({ [META_KEY]: metaJson("public") });
    const res = await serveSkillMeta(kv, "acme", "widget");
    expect(res.status).toBe(200);
  });

  it("404s meta for an org-visibility skill", async () => {
    const kv = stubKv({ [META_KEY]: metaJson("org") });
    const res = await serveSkillMeta(kv, "acme", "widget");
    expect(res.status).toBe(404);
  });
});
