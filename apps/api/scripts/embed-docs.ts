#!/usr/bin/env npx tsx
/**
 * Embed Skillist's own docs (apps/docs/src/content/docs/**\/*.mdx) into the
 * `skillist-failures` Vectorize index so the platform agent's `search_docs`
 * tool can ground how-to answers.
 *
 * This script does the filesystem-side work only — walk each .mdx page, strip
 * frontmatter + MDX scaffolding, and chunk by heading (~700 tokens) — then POSTs
 * the passages to the deployed API's `POST /v1/admin/reindex-docs`. The Worker
 * embeds (via the `env.AI` binding) and upserts (via `env.VECTORIZE`), so there
 * is NO Workers-AI API token to manage here: the binding handles inference.
 * Deterministic chunk ids → the upsert is idempotent, so re-running after a docs
 * edit overwrites in place rather than duplicating.
 *
 * Filtering doc vectors on `kind` needs a one-time metadata index (already
 * created in prod):
 *   wrangler vectorize create-metadata-index skillist-failures \
 *     --property-name=kind --type=string
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   SKILLIST_API_KEY=sk_...  pnpm embed:docs
 *   # SKILLIST_API_KEY must be an API key created by a platform admin (a user id
 *   # in SKILLIST_ADMIN_USER_IDS). Override the target with SKILLIST_API_URL
 *   # (defaults to https://api.skillist.io).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkDocByHeading, docChunkId, stripMdx } from "../src/lib/docs-rag.ts";

const API_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = join(API_ROOT, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "apps", "docs", "src", "content", "docs");

const API_URL = (process.env.SKILLIST_API_URL ?? "https://api.skillist.io").replace(/\/$/, "");
const API_KEY = process.env.SKILLIST_API_KEY;
// The endpoint caps a request at 100 chunks; stay under it and keep each embed
// batch a reasonable size for Workers AI.
const UPLOAD_BATCH = 50;

type Chunk = { id: string; page: string; heading: string; text: string };

async function walkMdx(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMdx(full)));
    else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** page = path relative to the docs root, without extension, POSIX-separated. */
function pageId(fullPath: string): string {
  return fullPath
    .slice(DOCS_DIR.length + 1)
    .replace(/\.(mdx|md)$/, "")
    .split(/[\\/]/)
    .join("/");
}

async function postBatch(chunks: Chunk[]): Promise<{ upserted: number; skipped: number }> {
  const res = await fetch(`${API_URL}/v1/admin/reindex-docs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ chunks }),
  });
  if (!res.ok) {
    throw new Error(`reindex-docs failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { upserted: number; skipped: number };
}

async function main() {
  if (!API_KEY) {
    throw new Error("Set SKILLIST_API_KEY to an admin's API key (sk_...).");
  }

  const files = (await walkMdx(DOCS_DIR)).sort();
  console.log(`Found ${files.length} doc pages under ${DOCS_DIR}`);

  // Chunk every page (pure helpers shared with the agent's search_docs).
  const chunks: Chunk[] = [];
  for (const file of files) {
    const page = pageId(file);
    const raw = await readFile(file, "utf8");
    const { title, body } = stripMdx(raw);
    chunkDocByHeading(body, title ?? page).forEach((ch, i) => {
      chunks.push({ id: docChunkId(page, i), page, heading: ch.heading, text: ch.text });
    });
  }
  console.log(`Chunked into ${chunks.length} passages → ${API_URL}`);

  // Upload in batches; the Worker embeds + upserts each batch.
  let upserted = 0;
  let skipped = 0;
  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH);
    const r = await postBatch(batch);
    upserted += r.upserted;
    skipped += r.skipped;
    console.log(`Upserted ${Math.min(i + UPLOAD_BATCH, chunks.length)}/${chunks.length}`);
  }
  console.log(`Done. Upserted ${upserted} doc vectors${skipped ? `, skipped ${skipped}` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
