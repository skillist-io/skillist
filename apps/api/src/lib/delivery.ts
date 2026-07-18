import { organizations, skills, skillVersions } from "@skillist/db/schema";
import { parseSkillMd, skillFrontmatterSchema } from "@skillist/skill-format";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { WorkerDb } from "./db";
import type { SkillKvMeta } from "./kv";
import {
  cacheVersionSnapshot,
  getPublishedMeta,
  getPublishedSkillMd,
  getVersionMeta,
  getVersionSkillMd,
} from "./publish";
import {
  bundleObjectKey,
  downloadBundleFromR2,
  listBundlePaths,
  putBundleObject,
  sha256,
} from "./r2";

// Mutable "latest" URLs: short freshness window, but let caches revalidate in
// the background and serve stale on origin errors rather than failing reads.
const LATEST_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";
// Bundles are heavier and change only on publish; give them a longer window.
const BUNDLE_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400";
// Exact-version URLs pin content that never changes once published.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type DeliveryEnv = { SKILLS_KV: KVNamespace; SKILLS_R2: R2Bucket };

// Only ever-published versions are addressable: archived means "superseded by
// a newer publish", which is exactly what pinning exists to keep serving.
const SERVABLE_VERSION_STATUSES = ["published", "archived"] as const;

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Splits a `{repo}` path segment into repo + optional pinned version:
 * `widget` and `widget@latest` → latest; `widget@1.2.3` → exact version.
 * Returns null for malformed specifiers (`widget@`, `widget@not-semver`).
 */
export function parseRepoSpecifier(repoParam: string): { repo: string; version?: string } | null {
  const at = repoParam.indexOf("@");
  if (at === -1) return { repo: repoParam };
  const repo = repoParam.slice(0, at);
  const specifier = repoParam.slice(at + 1);
  if (!repo) return null;
  if (specifier === "latest") return { repo };
  if (!EXACT_SEMVER.test(specifier)) return null;
  return { repo, version: specifier };
}

function notFound(): Response {
  // Cache negative lookups briefly so misses don't hammer KV/DB, but keep the
  // window short: a just-published skill should appear within seconds.
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "public, max-age=30" } },
  );
}

/**
 * RFC 9110 If-None-Match check. Our stored etags are raw hex; we serve them
 * quoted and accept quoted, weak-prefixed, bare, and `*` forms back.
 */
function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//i, "").replace(/^"|"$/g, ""))
    .includes(etag);
}

function conditionalHeaders(etag: string, version: string, cacheControl: string) {
  return {
    ETag: `"${etag}"`,
    "Cache-Control": cacheControl,
    "X-Skillist-Version": version,
    "X-Content-Type-Options": "nosniff",
  };
}

function skillMdResponse(
  skillMd: string,
  meta: Pick<SkillKvMeta, "etag" | "version" | "contentSha256">,
  cacheControl: string,
  ifNoneMatch: string | null,
): Response {
  const headers: Record<string, string> = conditionalHeaders(meta.etag, meta.version, cacheControl);
  if (meta.contentSha256) {
    headers["X-Skillist-Content-Sha256"] = meta.contentSha256;
  }
  if (etagMatches(ifNoneMatch, meta.etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers["Content-Type"] = "text/markdown; charset=utf-8";
  return new Response(skillMd, { headers });
}

function metaResponse(
  meta: SkillKvMeta,
  cacheControl: string,
  ifNoneMatch: string | null,
): Response {
  const headers = conditionalHeaders(meta.etag, meta.version, cacheControl);
  if (etagMatches(ifNoneMatch, meta.etag)) {
    return new Response(null, { status: 304, headers });
  }
  // bundleKey is an internal storage pointer, not part of the public contract.
  const { bundleKey: _bundleKey, ...publicMeta } = meta;
  return Response.json(publicMeta, { headers });
}

export async function serveSkillMd(
  kv: KVNamespace,
  org: string,
  repo: string,
  ifNoneMatch: string | null = null,
): Promise<Response> {
  const cached = await getPublishedSkillMd(kv, org, repo);
  // Fail closed: these routes are public and unauthenticated, so serve only
  // skills explicitly marked public. A missing visibility (pre-visibility cache
  // entry) is treated as not-public and 404s until the skill is republished.
  if (cached?.meta.visibility !== "public") {
    return notFound();
  }
  return skillMdResponse(cached.skillMd, cached.meta, LATEST_CACHE_CONTROL, ifNoneMatch);
}

export async function serveSkillMeta(
  kv: KVNamespace,
  org: string,
  repo: string,
  ifNoneMatch: string | null = null,
): Promise<Response> {
  const meta = await getPublishedMeta(kv, org, repo);
  if (meta?.visibility !== "public") {
    return notFound();
  }
  return metaResponse(meta, LATEST_CACHE_CONTROL, ifNoneMatch);
}

export async function serveSkillMdAtVersion(
  env: DeliveryEnv,
  getDb: () => WorkerDb,
  org: string,
  repo: string,
  version: string,
  ifNoneMatch: string | null = null,
): Promise<Response> {
  const cached = await getVersionSkillMd(env.SKILLS_KV, org, repo, version);
  if (cached) {
    if (cached.meta.visibility !== "public") {
      return notFound();
    }
    return skillMdResponse(cached.skillMd, cached.meta, IMMUTABLE_CACHE_CONTROL, ifNoneMatch);
  }
  const snapshot = await backfillVersionSnapshot(env, getDb(), org, repo, version);
  if (!snapshot) {
    return notFound();
  }
  return skillMdResponse(snapshot.skillMd, snapshot.meta, IMMUTABLE_CACHE_CONTROL, ifNoneMatch);
}

export async function serveSkillMetaAtVersion(
  env: DeliveryEnv,
  getDb: () => WorkerDb,
  org: string,
  repo: string,
  version: string,
  ifNoneMatch: string | null = null,
): Promise<Response> {
  const meta = await getVersionMeta(env.SKILLS_KV, org, repo, version);
  if (meta) {
    if (meta.visibility !== "public") {
      return notFound();
    }
    return metaResponse(meta, IMMUTABLE_CACHE_CONTROL, ifNoneMatch);
  }
  const snapshot = await backfillVersionSnapshot(env, getDb(), org, repo, version);
  if (!snapshot) {
    return notFound();
  }
  return metaResponse(snapshot.meta, IMMUTABLE_CACHE_CONTROL, ifNoneMatch);
}

/**
 * Miss path for versions published before per-version KV keys existed (or
 * evicted-by-nothing — KV keys have no TTL, so in practice: pre-feature
 * versions). Loads the version from Postgres + R2, writes the per-version KV
 * keys through (jsDelivr-style lazy permanent fill), and returns the snapshot.
 * The DB is only ever touched on this one-time-per-version miss, keeping the
 * hot path KV-only.
 */
async function backfillVersionSnapshot(
  env: DeliveryEnv,
  db: WorkerDb,
  org: string,
  repo: string,
  semver: string,
): Promise<{ skillMd: string; meta: SkillKvMeta } | null> {
  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return null;

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  // Fail closed: pinned versions of non-public skills are never served.
  if (!skill || skill.visibility !== "public") return null;

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, skill.id),
        eq(skillVersions.semver, semver),
        inArray(skillVersions.status, [...SERVABLE_VERSION_STATUSES]),
      ),
    )
    .orderBy(desc(skillVersions.publishedAt))
    .limit(1);
  if (!version) return null;

  const obj = await env.SKILLS_R2.get(`${version.r2Prefix}/SKILL.md`);
  if (!obj) return null;
  const skillMd = await obj.text();

  const contentSha256 = await sha256(skillMd);
  const etag = version.kvEtag ?? contentSha256.slice(0, 16);
  const parsed = parseSkillMd(skillMd);
  const frontmatter = parsed ? skillFrontmatterSchema.safeParse(parsed.frontmatter) : null;
  const meta: SkillKvMeta = {
    name: frontmatter?.success ? frontmatter.data.name : repo,
    description: frontmatter?.success ? frontmatter.data.description : (skill.description ?? ""),
    version: version.semver,
    versionId: version.id,
    etag,
    org,
    repo,
    publishedAt: (version.publishedAt ?? version.createdAt).toISOString(),
    visibility: "public",
    contentSha256,
    // Deterministic from r2Prefix; the object itself is materialized lazily by
    // the bundle route if it doesn't exist yet.
    bundleKey: bundleObjectKey(version.r2Prefix),
  };
  await cacheVersionSnapshot(env.SKILLS_KV, org, repo, { skillMd, meta });
  return { skillMd, meta };
}

export async function serveSkillBundle(
  env: DeliveryEnv,
  getDb: () => WorkerDb,
  org: string,
  repo: string,
  ifNoneMatch: string | null = null,
  pinnedVersion?: string,
): Promise<Response> {
  const cacheControl = pinnedVersion ? IMMUTABLE_CACHE_CONTROL : BUNDLE_CACHE_CONTROL;

  // Hot path: KV meta points at the bundle JSON materialized at publish time —
  // one KV read plus one R2 stream, no DB, no list, no re-encoding.
  const kvMeta = pinnedVersion
    ? await getVersionMeta(env.SKILLS_KV, org, repo, pinnedVersion)
    : await getPublishedMeta(env.SKILLS_KV, org, repo);
  if (kvMeta) {
    if (kvMeta.visibility !== "public") {
      return notFound();
    }
    const headers = conditionalHeaders(kvMeta.versionId, kvMeta.version, cacheControl);
    if (etagMatches(ifNoneMatch, kvMeta.versionId)) {
      return new Response(null, { status: 304, headers });
    }
    if (kvMeta.bundleKey) {
      const obj = await env.SKILLS_R2.get(kvMeta.bundleKey);
      if (obj) {
        return new Response(obj.body, {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      // Object missing (pre-materialization version): fall through to the DB
      // path below, which rebuilds and writes it.
    }
  }

  const db = getDb();
  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) {
    return notFound();
  }

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  // Bundle delivery is public and unauthenticated — only public skills, and
  // (on the latest path) only once they have a published version.
  if (!skill || skill.visibility !== "public") {
    return notFound();
  }
  if (!pinnedVersion && !skill.latestPublishedVersionId) {
    return notFound();
  }

  const [version] = pinnedVersion
    ? await db
        .select()
        .from(skillVersions)
        .where(
          and(
            eq(skillVersions.skillId, skill.id),
            eq(skillVersions.semver, pinnedVersion),
            inArray(skillVersions.status, [...SERVABLE_VERSION_STATUSES]),
          ),
        )
        .orderBy(desc(skillVersions.publishedAt))
        .limit(1)
    : await db
        .select()
        .from(skillVersions)
        // biome-ignore lint/style/noNonNullAssertion: guarded above for the latest path
        .where(eq(skillVersions.id, skill.latestPublishedVersionId!))
        .limit(1);
  if (!version) {
    return notFound();
  }

  // The version id uniquely identifies the bundle contents (kvEtag only covers
  // SKILL.md), so it is the correct ETag here. A match short-circuits before
  // any R2 traffic.
  const headers = conditionalHeaders(version.id, version.semver, cacheControl);
  if (etagMatches(ifNoneMatch, version.id)) {
    return new Response(null, { status: 304, headers });
  }

  // Serve the materialized object if it exists; otherwise assemble it once
  // from the per-file tree and write it through so the next request streams.
  const key = bundleObjectKey(version.r2Prefix);
  const existing = await env.SKILLS_R2.get(key);
  if (existing) {
    return new Response(existing.body, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  await putBundleObject(env.SKILLS_R2, version.r2Prefix, bundle, version.semver);
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return Response.json({ files, version: version.semver }, { headers });
}
