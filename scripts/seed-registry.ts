#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
/**
 * Seed public registry skills from examples/skills/ into production.
 *
 * Usage:
 *   DATABASE_URL=... pnpm seed:registry
 *   DATABASE_URL=... pnpm seed:registry --local   # wrangler dev R2/KV
 *
 * Requires: wrangler logged in or CLOUDFLARE_API_TOKEN set.
 */
import { createHash, randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@skillist/db";
import {
  organizations,
  orgMembers,
  registryEntries,
  skillFiles,
  skills,
  skillVersions,
  users,
} from "@skillist/db/schema";
import {
  estimateImpactScore,
  extractAgentDiscovery,
  extractRegistryDiscovery,
  objectToBundle,
  parsePluginManifest,
  reviewSkillBundle,
  scanSkillSecurity,
  validateSkillBundle,
} from "@skillist/skill-format";
import { and, eq } from "drizzle-orm";
import { detectSkillRuntime } from "../apps/api/src/lib/skill-runtime.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const EXAMPLES_DIR = join(ROOT, "examples", "skills");
const ORG_SLUG = "skillist";
const ORG_NAME = "Skillist";
const IS_LOCAL = process.argv.includes("--local");

const R2_BUCKET = IS_LOCAL ? "skillist-skills-preview" : "skillist-skills";
const KV_NAMESPACE_ID = "e3efe45d7f14430ab6c5868235e6755f";
const WRANGLER_DIR = join(ROOT, "apps", "api");
const WRANGLER_CONFIG = IS_LOCAL ? "-c wrangler.jsonc" : "-c wrangler.production.jsonc";

const SKILL_LEVELS: Record<string, string> = {
  "roll-dice": "1.0.0",
  "web-perf-audit": "1.0.0",
  "cloudflare-deploy": "1.0.0",
  "api-design": "1.0.0",
  "sql-review": "1.0.0",
  "git-commit": "1.0.0",
  "security-audit": "1.0.0",
  "docs-writer": "1.0.0",
  "test-generator": "1.0.0",
  "stripe-integration": "1.0.0",
  "registry-mcp": "1.0.0",
};

async function walkBundle(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function walk(current: string, prefix: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        files.set(rel, await readFile(full, "utf8"));
      }
    }
  }

  await walk(dir, "");
  return files;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function skillMetaKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:meta`;
}

function skillMdKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:latest`;
}

function r2Prefix(orgId: string, skillRepo: string, versionId: string) {
  return `orgs/${orgId}/skills/${skillRepo}/v/${versionId}`;
}

function wrangler(cmd: string) {
  execSync(`pnpm exec wrangler ${cmd}`, {
    cwd: WRANGLER_DIR,
    stdio: "inherit",
    env: process.env,
  });
}

function putR2Object(key: string, filePath: string) {
  const remote = IS_LOCAL ? "" : "--remote";
  wrangler(`r2 object put ${R2_BUCKET}/${key} --file=${filePath} ${remote}`.trim());
}

function putKvKey(key: string, value: string) {
  const remote = IS_LOCAL ? "" : "--remote";
  const tmp = join(ROOT, ".seed-kv-tmp.json");
  writeFileSync(tmp, value, "utf8");
  wrangler(`kv key put --namespace-id=${KV_NAMESPACE_ID} "${key}" --path=${tmp} ${remote}`.trim());
  unlinkSync(tmp);
}

async function uploadBundleToR2(prefix: string, bundle: Map<string, string>): Promise<void> {
  const tmpDir = join(ROOT, ".seed-r2-tmp");
  await mkdir(tmpDir, { recursive: true });
  for (const [path, content] of bundle.entries()) {
    const localPath = join(tmpDir, path.replace(/\//g, "__"));
    await writeFile(localPath, content, "utf8");
    putR2Object(`${prefix}/${path}`, localPath);
  }
  await rm(tmpDir, { recursive: true, force: true });
}

async function ensureOrg(db: ReturnType<typeof createDb>) {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);

  if (existing) return existing;

  const [user] = await db.select().from(users).limit(1);
  const [org] = await db
    .insert(organizations)
    .values({
      name: ORG_NAME,
      slug: ORG_SLUG,
      publishPolicy: {
        minQualityScore: 40,
        blockOnAdvisory: false,
        requireSecurityPass: false,
      },
    })
    .returning();

  if (user && org) {
    await db
      .insert(orgMembers)
      .values({ orgId: org.id, userId: user.id, role: "owner" })
      .onConflictDoNothing();
  }

  console.log(`Created org ${ORG_SLUG} (${org!.id})`);
  return org!;
}

async function seedSkill(
  db: ReturnType<typeof createDb>,
  org: { id: string; slug: string },
  slug: string,
  bundle: Map<string, string>,
) {
  const validation = validateSkillBundle(bundle, slug);
  if (!validation.valid) {
    throw new Error(`${slug}: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  const review = reviewSkillBundle(bundle, slug);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const runtime = detectSkillRuntime(bundle);

  if (security.status === "fail") {
    throw new Error(`${slug}: security fail — ${security.issues.map((i) => i.message).join("; ")}`);
  }

  console.log(
    `\n${slug}: quality=${review.score} impact=${impactScore} security=${security.status}`,
  );

  let [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, org.id), eq(skills.repo, slug)))
    .limit(1);

  if (!skill) {
    [skill] = await db
      .insert(skills)
      .values({
        orgId: org.id,
        repo: slug,
        visibility: "public",
        description: validation.frontmatter.description,
        runtime,
      })
      .returning();
  } else {
    await db
      .update(skills)
      .set({
        visibility: "public",
        description: validation.frontmatter.description,
        runtime,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skill.id));
  }

  const versionId = randomUUID();
  const semver = SKILL_LEVELS[slug] ?? "1.0.0";
  const prefix = r2Prefix(org.id, slug, versionId);
  const skillMd = bundle.get("SKILL.md")!;
  const etag = sha256(skillMd).slice(0, 16);
  const publishedAt = new Date();

  await uploadBundleToR2(prefix, bundle);

  const reviewChecks = review.checks.map(({ id, label, passed, message }) => ({
    id,
    label,
    passed,
    message,
  }));

  await db.insert(skillVersions).values({
    id: versionId,
    skillId: skill!.id,
    status: "published",
    semver,
    r2Prefix: prefix,
    publishedAt,
    kvEtag: etag,
    qualityScore: review.score,
    impactScore,
    securityStatus: security.status,
    securityIssues: security.issues,
    reviewChecks,
    pluginManifest: pluginManifest ?? null,
  });

  for (const [path, content] of bundle.entries()) {
    await db.insert(skillFiles).values({
      versionId,
      path,
      sha256: sha256(content),
      size: content.length,
    });
  }

  await db
    .update(skills)
    .set({
      latestPublishedVersionId: versionId,
      description: validation.frontmatter.description,
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skill!.id));

  const meta = {
    name: validation.frontmatter.name,
    description: validation.frontmatter.description,
    version: semver,
    versionId,
    etag,
    org: org.slug,
    repo: slug,
    publishedAt: publishedAt.toISOString(),
  };

  putKvKey(skillMetaKey(org.slug, slug), JSON.stringify(meta));
  putKvKey(skillMdKey(org.slug, slug), skillMd);

  const discovery = extractRegistryDiscovery(validation.frontmatter);
  const compatibleAgents = extractAgentDiscovery(pluginManifest);
  await db
    .insert(registryEntries)
    .values({
      skillId: skill!.id,
      orgSlug: org.slug,
      skillRepo: slug,
      name: validation.frontmatter.name,
      description: validation.frontmatter.description,
      latestVersion: semver,
      qualityScore: review.score,
      impactScore,
      securityStatus: security.status,
      category: discovery.category,
      tags: discovery.tags,
      compatibleAgents,
      lastReviewedAt: publishedAt,
    })
    .onConflictDoUpdate({
      target: registryEntries.skillId,
      set: {
        name: validation.frontmatter.name,
        description: validation.frontmatter.description,
        latestVersion: semver,
        qualityScore: review.score,
        impactScore,
        securityStatus: security.status,
        category: discovery.category,
        tags: discovery.tags,
        compatibleAgents,
        lastReviewedAt: publishedAt,
        updatedAt: new Date(),
      },
    });

  console.log(`  ✓ published ${org.slug}/${slug} v${semver} (${bundle.size} files)`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(connectionString);
  const org = await ensureOrg(db);

  const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  console.log(
    `Seeding ${skillDirs.length} skills to org/${ORG_SLUG} (${IS_LOCAL ? "local" : "production"} R2/KV)`,
  );

  for (const slug of skillDirs.sort()) {
    const dir = join(EXAMPLES_DIR, slug);
    const bundle = await walkBundle(dir);
    await seedSkill(db, org, slug, bundle);
  }

  console.log("\nDone. Verify:");
  const delivery = IS_LOCAL ? "http://localhost:8787" : "https://skillist.io";
  const api = IS_LOCAL ? "http://localhost:8787" : "https://api.skillist.io";
  console.log(`  curl ${api}/v1/registry`);
  console.log(`  curl ${delivery}/${ORG_SLUG}/roll-dice/SKILL.md`);
  console.log(`  open ${delivery}/${ORG_SLUG}/roll-dice`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
