import { describe, expect, it } from "vitest";
import { serveSkillMd, serveSkillMeta } from "./delivery";

function stubKv(
  entries: Record<string, string>,
  metadata: Record<string, unknown> = {},
): KVNamespace {
  return {
    get: async (key: string) => entries[key] ?? null,
    getWithMetadata: async (key: string) => ({
      value: entries[key] ?? null,
      metadata: metadata[key] ?? null,
    }),
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

  it("fails closed on per-key metadata without visibility", async () => {
    const kv = stubKv({ [MD_KEY]: SKILL_MD }, { [MD_KEY]: { etag: "etag123", version: "1.0.0" } });
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

describe("delivery single-read metadata path", () => {
  const perKeyMeta = {
    etag: "etag123",
    version: "1.0.0",
    visibility: "public",
    contentSha256: "a".repeat(64),
  };

  it("serves SKILL.md from per-key metadata without reading the meta key", async () => {
    // No META_KEY entry: only the per-key metadata is available.
    const kv = stubKv({ [MD_KEY]: SKILL_MD }, { [MD_KEY]: perKeyMeta });
    const res = await serveSkillMd(kv, "acme", "widget");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SKILL_MD);
    expect(res.headers.get("ETag")).toBe('"etag123"');
    expect(res.headers.get("X-Skillist-Version")).toBe("1.0.0");
    expect(res.headers.get("X-Skillist-Content-Sha256")).toBe("a".repeat(64));
    expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate");
  });

  it("falls back to the meta key for pre-metadata cache entries", async () => {
    const kv = stubKv({ [MD_KEY]: SKILL_MD, [META_KEY]: metaJson("public") });
    const res = await serveSkillMd(kv, "acme", "widget");
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"etag123"');
  });
});

describe("delivery conditional requests", () => {
  const kv = () => stubKv({ [MD_KEY]: SKILL_MD, [META_KEY]: metaJson("public") });

  it("returns 304 for a matching quoted If-None-Match", async () => {
    const res = await serveSkillMd(kv(), "acme", "widget", '"etag123"');
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("ETag")).toBe('"etag123"');
    expect(res.headers.get("Cache-Control")).toBeTruthy();
  });

  it("returns 304 for weak and bare etag forms", async () => {
    expect((await serveSkillMd(kv(), "acme", "widget", 'W/"etag123"')).status).toBe(304);
    expect((await serveSkillMd(kv(), "acme", "widget", "etag123")).status).toBe(304);
    expect((await serveSkillMd(kv(), "acme", "widget", '"old", "etag123"')).status).toBe(304);
    expect((await serveSkillMd(kv(), "acme", "widget", "*")).status).toBe(304);
  });

  it("returns 200 for a non-matching If-None-Match", async () => {
    const res = await serveSkillMd(kv(), "acme", "widget", '"stale"');
    expect(res.status).toBe(200);
  });

  it("returns 304 on meta for a matching If-None-Match", async () => {
    const res = await serveSkillMeta(kv(), "acme", "widget", '"etag123"');
    expect(res.status).toBe(304);
  });

  it("caches 404s briefly", async () => {
    const res = await serveSkillMd(stubKv({}), "acme", "widget");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
  });
});
