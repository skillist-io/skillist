import {
  type Skill,
  type SkillReadResult,
  type SkillSource,
  SkillsExtension,
} from "@modelcontextprotocol/server/ext/skills";
import {
  organizations,
  projectItems,
  projects,
  skillFiles,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import { isBinaryAssetPath, parseSkillMd } from "@skillist/skill-format";
import type { McpSession } from "better-auth/plugins/mcp/client";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { inList, type WorkerDb } from "../lib/db";
import { readableProjectsFilter } from "../lib/project-access";
import { contentTypeForPath } from "../lib/r2";

const SKILL_URI_SCHEME = "skill://";
const SKILL_MD = "SKILL.md";
const LIST_PAGE_SIZE = 50;

/** Short on purpose: a publish should reach hosts quickly, and they refetch by digest anyway. */
const PUBLIC_CACHE_TTL_MS = 60_000;

type PublishedSkillRow = {
  orgSlug: string;
  repo: string;
  versionId: string;
  r2Prefix: string;
};

const publishedSkillColumns = {
  orgSlug: organizations.slug,
  repo: skills.repo,
  versionId: skillVersions.id,
  r2Prefix: skillVersions.r2Prefix,
};

/**
 * The fail-closed gate for everything served here. Only public skills qualify:
 * delivery has the same rule, and private skills need their own access design
 * before they can be exposed (including `cacheScope`, which is per-response).
 */
const servableSkill = and(eq(skills.visibility, "public"), eq(skillVersions.status, "published"));

/** Maps `skill://{org}/{repo}/{path}` to its parts. The path is only ever matched against `skill_files`. */
function parseSkillUri(uri: string) {
  if (!uri.startsWith(SKILL_URI_SCHEME)) return null;
  const [org, repo, ...rest] = uri.slice(SKILL_URI_SCHEME.length).split("/");
  if (!org || !repo || rest.length === 0) return null;
  return { org, repo, path: rest.join("/") };
}

function fileUri(row: PublishedSkillRow, path: string) {
  return `${SKILL_URI_SCHEME}${row.orgSlug}/${row.repo}/${path}`;
}

function publishedSkills(db: WorkerDb, where: SQL | undefined) {
  return db
    .select(publishedSkillColumns)
    .from(skills)
    .innerJoin(organizations, eq(skills.orgId, organizations.id))
    .innerJoin(skillVersions, eq(skillVersions.id, skills.latestPublishedVersionId))
    .where(and(servableSkill, where));
}

async function findPublishedSkill(db: WorkerDb, org: string, repo: string) {
  const [row] = await publishedSkills(
    db,
    and(eq(organizations.slug, org), eq(skills.repo, repo)),
  ).limit(1);
  return row;
}

/**
 * Builds entries from one pinned version: frontmatter, manifest and later reads
 * all resolve through `latest_published_version_id`. Mixing in the KV copy could
 * pair a new SKILL.md with an old manifest mid-publish, and hosts reject that.
 * A version missing its SKILL.md row or object is dropped rather than served
 * with a partial manifest.
 */
async function toSkillEntries(
  db: WorkerDb,
  bucket: R2Bucket,
  rows: PublishedSkillRow[],
): Promise<Skill[]> {
  if (rows.length === 0) return [];
  const files = await db
    .select({
      versionId: skillFiles.versionId,
      path: skillFiles.path,
      sha256: skillFiles.sha256,
      size: skillFiles.size,
    })
    .from(skillFiles)
    .where(
      inList(
        skillFiles.versionId,
        rows.map((r) => r.versionId),
      ),
    )
    .orderBy(asc(skillFiles.path));

  const entries = await Promise.all(
    rows.map(async (row): Promise<Skill | undefined> => {
      const versionFiles = files.filter((f) => f.versionId === row.versionId);
      if (!versionFiles.some((f) => f.path === SKILL_MD)) return undefined;

      const obj = await bucket.get(`${row.r2Prefix}/${SKILL_MD}`);
      if (!obj) return undefined;
      const frontmatter = parseSkillMd(await obj.text())?.frontmatter;
      if (!frontmatter || typeof frontmatter !== "object") return undefined;

      return {
        uri: fileUri(row, SKILL_MD),
        frontmatter: frontmatter as Skill["frontmatter"],
        resources: versionFiles.map((f) => ({
          uri: fileUri(row, f.path),
          digest: `sha256:${f.sha256}`,
          size: f.size,
        })),
      };
    }),
  );
  return entries.filter((entry) => entry !== undefined);
}

export function createSkillSource(
  db: WorkerDb,
  bucket: R2Bucket,
  session: McpSession | null,
): SkillSource {
  return {
    // Partial by design: the spec allows it, and a host puts every listed skill
    // in front of its model. Callers see the skills their projects curate;
    // anything else public stays reachable by URI through `get`.
    async list({ cursor }) {
      if (!session) return { skills: [] };
      const readable = await readableProjectsFilter(db, session.userId);
      if (!readable) return { skills: [] };

      const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
      const rows = await db
        .selectDistinct({ ...publishedSkillColumns, skillId: skills.id })
        .from(projectItems)
        .innerJoin(projects, eq(projectItems.projectId, projects.id))
        .innerJoin(skills, eq(projectItems.skillId, skills.id))
        .innerJoin(organizations, eq(skills.orgId, organizations.id))
        .innerJoin(skillVersions, eq(skillVersions.id, skills.latestPublishedVersionId))
        .where(and(servableSkill, readable))
        .orderBy(asc(skills.id))
        .limit(LIST_PAGE_SIZE + 1)
        .offset(offset);

      const page = rows.slice(0, LIST_PAGE_SIZE);
      return {
        skills: await toSkillEntries(db, bucket, page),
        ...(rows.length > LIST_PAGE_SIZE ? { nextCursor: String(offset + LIST_PAGE_SIZE) } : {}),
      };
    },

    async get(uri) {
      const parsed = parseSkillUri(uri);
      if (parsed?.path !== SKILL_MD) return undefined;
      const row = await findPublishedSkill(db, parsed.org, parsed.repo);
      if (!row) return undefined;
      const [entry] = await toSkillEntries(db, bucket, [row]);
      return entry;
    },

    async read(uri): Promise<SkillReadResult | undefined> {
      const parsed = parseSkillUri(uri);
      if (!parsed) return undefined;
      const row = await findPublishedSkill(db, parsed.org, parsed.repo);
      if (!row) return undefined;

      // The manifest is the allowlist: a path that isn't a file row never
      // reaches R2, so `..` or a sibling object key can't be read through here.
      const [file] = await db
        .select({ path: skillFiles.path })
        .from(skillFiles)
        .where(and(eq(skillFiles.versionId, row.versionId), eq(skillFiles.path, parsed.path)))
        .limit(1);
      if (!file) return undefined;

      const obj = await bucket.get(`${row.r2Prefix}/${file.path}`);
      if (!obj) return undefined;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const mimeType = contentTypeForPath(file.path);
      if (isBinaryAssetPath(file.path)) return { bytes, mimeType };
      // ignoreBOM keeps a leading BOM in the text. The default strips it, which
      // changes the bytes a host hashes and fails its digest check.
      return {
        text: new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes),
        mimeType,
      };
    },
  };
}

export function createSkillsExtension(
  db: WorkerDb,
  bucket: R2Bucket,
  session: McpSession | null,
): SkillsExtension {
  return new SkillsExtension({
    source: createSkillSource(db, bucket, session),
    // A signed-in listing is per-user, so nothing about it may be shared. The
    // server is built per request, which is what lets this vary by caller.
    cacheHint: session
      ? { ttlMs: 0, cacheScope: "private" }
      : { ttlMs: PUBLIC_CACHE_TTL_MS, cacheScope: "public" },
  });
}
