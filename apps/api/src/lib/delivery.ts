import { organizations, skills, skillVersions } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerDb } from "./db";
import { getPublishedMeta, getPublishedSkillMd } from "./publish";
import { downloadBundleFromR2, listBundlePaths } from "./r2";

export async function serveSkillMd(kv: KVNamespace, org: string, repo: string): Promise<Response> {
  const cached = await getPublishedSkillMd(kv, org, repo);
  if (!cached) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(cached.skillMd, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ETag: cached.meta.etag,
      "Cache-Control": "public, max-age=60",
      "X-Skillist-Version": cached.meta.version,
    },
  });
}

export async function serveSkillMeta(
  kv: KVNamespace,
  org: string,
  repo: string,
): Promise<Response> {
  const meta = await getPublishedMeta(kv, org, repo);
  if (!meta) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(meta);
}

export async function serveSkillBundle(
  env: { SKILLS_R2: R2Bucket },
  db: WorkerDb,
  org: string,
  repo: string,
): Promise<Response> {
  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  if (!skill || !skill.latestPublishedVersionId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return Response.json({ files, version: version.semver });
}
