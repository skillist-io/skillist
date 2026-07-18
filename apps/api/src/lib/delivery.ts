import { organizations, skills, skillVersions } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerDb } from "./db";
import { getPublishedMeta, getPublishedSkillMd } from "./publish";
import { downloadBundleFromR2, listBundlePaths } from "./r2";

// Mutable "latest" URLs: short freshness window, but let caches revalidate in
// the background and serve stale on origin errors rather than failing reads.
const LATEST_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";
// Bundles are heavier and change only on publish; give them a longer window.
const BUNDLE_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400";

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
  const headers: Record<string, string> = conditionalHeaders(
    cached.meta.etag,
    cached.meta.version,
    LATEST_CACHE_CONTROL,
  );
  if (cached.meta.contentSha256) {
    headers["X-Skillist-Content-Sha256"] = cached.meta.contentSha256;
  }
  if (etagMatches(ifNoneMatch, cached.meta.etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers["Content-Type"] = "text/markdown; charset=utf-8";
  return new Response(cached.skillMd, { headers });
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
  const headers = conditionalHeaders(meta.etag, meta.version, LATEST_CACHE_CONTROL);
  if (etagMatches(ifNoneMatch, meta.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json(meta, { headers });
}

export async function serveSkillBundle(
  env: { SKILLS_R2: R2Bucket },
  db: WorkerDb,
  org: string,
  repo: string,
  ifNoneMatch: string | null = null,
): Promise<Response> {
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
  // only once they have a published version, may be served here.
  if (!skill || !skill.latestPublishedVersionId || skill.visibility !== "public") {
    return notFound();
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) {
    return notFound();
  }

  // The version id uniquely identifies the bundle contents (kvEtag only covers
  // SKILL.md), so it is the correct ETag here. A match short-circuits before
  // any R2 traffic.
  const headers = conditionalHeaders(version.id, version.semver, BUNDLE_CACHE_CONTROL);
  if (etagMatches(ifNoneMatch, version.id)) {
    return new Response(null, { status: 304, headers });
  }

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return Response.json({ files, version: version.semver }, { headers });
}
