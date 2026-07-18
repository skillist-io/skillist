import { describe, expect, it } from "vitest";
import type { WorkerDb } from "./db";
import {
  parseRepoSpecifier,
  serveSkillBundle,
  serveSkillMd,
  serveSkillMdAtVersion,
  serveSkillMeta,
  serveSkillMetaAtVersion,
} from "./delivery";

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

describe("parseRepoSpecifier", () => {
  it("parses plain, latest, and exact-version specifiers", () => {
    expect(parseRepoSpecifier("widget")).toEqual({ repo: "widget" });
    expect(parseRepoSpecifier("widget@latest")).toEqual({ repo: "widget" });
    expect(parseRepoSpecifier("widget@1.2.3")).toEqual({ repo: "widget", version: "1.2.3" });
    expect(parseRepoSpecifier("widget@1.2.3-beta.1")).toEqual({
      repo: "widget",
      version: "1.2.3-beta.1",
    });
  });

  it("rejects malformed specifiers", () => {
    expect(parseRepoSpecifier("widget@")).toBeNull();
    expect(parseRepoSpecifier("@1.2.3")).toBeNull();
    expect(parseRepoSpecifier("widget@1.2")).toBeNull();
    expect(parseRepoSpecifier("widget@banana")).toBeNull();
  });
});

describe("versioned delivery", () => {
  const V_MD_KEY = "skill:acme:widget:v:1.0.0";
  const V_META_KEY = "skill:acme:widget:v:1.0.0:meta";
  const versionKvMeta = {
    etag: "etag123",
    version: "1.0.0",
    visibility: "public",
    contentSha256: "a".repeat(64),
  };
  const dbNotNeeded = () => {
    throw new Error("versioned KV hit must not touch the DB");
  };
  const env = (kv: KVNamespace) => ({ SKILLS_KV: kv, SKILLS_R2: {} as R2Bucket });

  it("serves a pinned SKILL.md from KV with immutable caching, without the DB", async () => {
    const kv = stubKv({ [V_MD_KEY]: SKILL_MD }, { [V_MD_KEY]: versionKvMeta });
    const res = await serveSkillMdAtVersion(env(kv), dbNotNeeded, "acme", "widget", "1.0.0");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SKILL_MD);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toBe('"etag123"');
    expect(res.headers.get("X-Skillist-Version")).toBe("1.0.0");
  });

  it("returns 304 on a pinned SKILL.md for a matching If-None-Match", async () => {
    const kv = stubKv({ [V_MD_KEY]: SKILL_MD }, { [V_MD_KEY]: versionKvMeta });
    const res = await serveSkillMdAtVersion(
      env(kv),
      dbNotNeeded,
      "acme",
      "widget",
      "1.0.0",
      '"etag123"',
    );
    expect(res.status).toBe(304);
  });

  it("fails closed on a pinned version cached as non-public", async () => {
    const kv = stubKv(
      { [V_MD_KEY]: SKILL_MD },
      { [V_MD_KEY]: { ...versionKvMeta, visibility: "private" } },
    );
    const res = await serveSkillMdAtVersion(env(kv), dbNotNeeded, "acme", "widget", "1.0.0");
    expect(res.status).toBe(404);
  });

  it("serves pinned meta from KV with immutable caching", async () => {
    const kv = stubKv({
      [V_META_KEY]: JSON.stringify({ ...JSON.parse(metaJson("public")), version: "1.0.0" }),
    });
    const res = await serveSkillMetaAtVersion(env(kv), dbNotNeeded, "acme", "widget", "1.0.0");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("versioned delivery backfill", () => {
  function stubDb(results: unknown[][]): WorkerDb {
    let call = 0;
    const chain = () => {
      const rows = results[call++] ?? [];
      const q = {
        from: () => q,
        where: () => q,
        orderBy: () => q,
        limit: () => Promise.resolve(rows),
      };
      return q;
    };
    return { select: chain } as unknown as WorkerDb;
  }

  function recordingKv(): { kv: KVNamespace; puts: Map<string, string> } {
    const puts = new Map<string, string>();
    const kv = {
      get: async () => null,
      getWithMetadata: async () => ({ value: null, metadata: null }),
      put: async (key: string, value: string) => {
        puts.set(key, value);
      },
    } as unknown as KVNamespace;
    return { kv, puts };
  }

  const publishedAt = new Date("2026-01-01T00:00:00.000Z");
  const rows = [
    [{ id: "org-1", slug: "acme" }],
    [{ id: "skill-1", visibility: "public", description: "y" }],
    [
      {
        id: "ver-1",
        semver: "0.9.0",
        r2Prefix: "orgs/org-1/skills/widget/v/ver-1",
        kvEtag: "oldetag",
        status: "archived",
        publishedAt,
        createdAt: publishedAt,
      },
    ],
  ];
  const r2 = {
    get: async (key: string) =>
      key === "orgs/org-1/skills/widget/v/ver-1/SKILL.md" ? { text: async () => SKILL_MD } : null,
  } as unknown as R2Bucket;

  it("backfills a pre-feature version from DB + R2 and writes it through to KV", async () => {
    const { kv, puts } = recordingKv();
    const res = await serveSkillMdAtVersion(
      { SKILLS_KV: kv, SKILLS_R2: r2 },
      () => stubDb(rows),
      "acme",
      "widget",
      "0.9.0",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SKILL_MD);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toBe('"oldetag"');
    expect(puts.get("skill:acme:widget:v:0.9.0")).toBe(SKILL_MD);
    const meta = JSON.parse(puts.get("skill:acme:widget:v:0.9.0:meta") ?? "{}");
    expect(meta.visibility).toBe("public");
    expect(meta.version).toBe("0.9.0");
    expect(meta.contentSha256).toHaveLength(64);
    // Backfill must never touch the mutable latest keys.
    expect(puts.has("skill:acme:widget:latest")).toBe(false);
    expect(puts.has("skill:acme:widget:meta")).toBe(false);
  });

  it("strips bundleKey from meta responses", async () => {
    const kv = stubKv({
      "skill:acme:widget:meta": JSON.stringify({
        ...JSON.parse(metaJson("public")),
        bundleKey: "orgs/org-1/skills/widget/v/v1.bundle.json",
      }),
    });
    const res = await serveSkillMeta(kv, "acme", "widget");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bundleKey).toBeUndefined();
    expect(body.etag).toBe("etag123");
  });

  it("streams a materialized bundle from KV meta + R2 without the DB", async () => {
    const bundleJson = JSON.stringify({ files: { "SKILL.md": SKILL_MD }, version: "1.0.0" });
    const kv = stubKv({
      "skill:acme:widget:meta": JSON.stringify({
        ...JSON.parse(metaJson("public")),
        bundleKey: "orgs/org-1/skills/widget/v/v1.bundle.json",
      }),
    });
    const r2 = {
      get: async (key: string) =>
        key === "orgs/org-1/skills/widget/v/v1.bundle.json"
          ? { body: new Response(bundleJson).body }
          : null,
    } as unknown as R2Bucket;
    const res = await serveSkillBundle(
      { SKILLS_KV: kv, SKILLS_R2: r2 },
      () => {
        throw new Error("bundle KV fast path must not touch the DB");
      },
      "acme",
      "widget",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: { "SKILL.md": SKILL_MD }, version: "1.0.0" });
    expect(res.headers.get("ETag")).toBe('"v1"');
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns 304 for a bundle without touching R2 or the DB", async () => {
    const kv = stubKv({
      "skill:acme:widget:meta": JSON.stringify({
        ...JSON.parse(metaJson("public")),
        bundleKey: "orgs/org-1/skills/widget/v/v1.bundle.json",
      }),
    });
    const res = await serveSkillBundle(
      {
        SKILLS_KV: kv,
        SKILLS_R2: {
          get: () => {
            throw new Error("304 must not touch R2");
          },
        } as unknown as R2Bucket,
      },
      () => {
        throw new Error("must not touch the DB");
      },
      "acme",
      "widget",
      '"v1"',
    );
    expect(res.status).toBe(304);
  });

  it("404s instead of materializing when a version has no files in R2", async () => {
    const { kv } = recordingKv();
    let putCalled = false;
    const emptyR2 = {
      get: async () => null,
      list: async () => ({ objects: [] }),
      put: async () => {
        putCalled = true;
      },
    } as unknown as R2Bucket;
    const bundleRows = [
      rows[0]!,
      [{ id: "skill-1", visibility: "public", latestPublishedVersionId: "ver-1" }],
      rows[2]!,
    ];
    const res = await serveSkillBundle(
      { SKILLS_KV: kv, SKILLS_R2: emptyR2 },
      () => stubDb(bundleRows),
      "acme",
      "widget",
    );
    expect(res.status).toBe(404);
    expect(putCalled).toBe(false);
  });

  it("404s a version pin for a non-public skill without touching R2", async () => {
    const { kv } = recordingKv();
    const privateRows = [rows[0]!, [{ id: "skill-1", visibility: "private" }]];
    const res = await serveSkillMdAtVersion(
      { SKILLS_KV: kv, SKILLS_R2: {} as R2Bucket },
      () => stubDb(privateRows),
      "acme",
      "widget",
      "0.9.0",
    );
    expect(res.status).toBe(404);
  });
});
