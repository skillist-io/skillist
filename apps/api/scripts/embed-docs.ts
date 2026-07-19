#!/usr/bin/env npx tsx
/**
 * Embed Skillist's own docs (apps/docs/src/content/docs/**\/*.mdx) into the
 * existing `skillist-failures` Vectorize index, so the platform agent's
 * `search_docs` tool can ground how-to answers.
 *
 * It walks each .mdx page, strips frontmatter + MDX scaffolding, chunks by
 * heading (~700 tokens), embeds each chunk with @cf/baai/bge-base-en-v1.5 (via
 * the Workers AI REST API), and UPSERTS the vectors (deterministic ids →
 * idempotent) with metadata `{ kind: "doc", page, heading, text }`. Doc vectors
 * carry `kind: "doc"` so they never collide with the failure-mining vectors in
 * the same index (which have `skillId`/`signature` and no `kind`).
 *
 * ── One-time index prep (filtering on `kind` needs a metadata index) ─────────
 *   wrangler vectorize create-metadata-index skillist-failures \
 *     --property-name=kind --type=string
 *   # (the index itself already exists:
 *   #  wrangler vectorize create skillist-failures --dimensions=768 --metric=cosine)
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm embed:docs
 *   # API token needs Workers AI (read) + Vectorize (edit). Requires `wrangler`
 *   # authenticated (or CLOUDFLARE_API_TOKEN in env) for the upsert step.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chunkDocByHeading,
  DOC_KIND,
  DOCS_EMBEDDING_MODEL,
  docChunkId,
  stripMdx,
} from "../src/lib/docs-rag.ts";

const API_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = join(API_ROOT, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "apps", "docs", "src", "content", "docs");
const VECTORIZE_INDEX = "skillist-failures";
const EMBED_BATCH = 50;

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

type DocVector = {
  id: string;
  values: number[];
  metadata: { kind: string; page: string; heading: string; text: string };
};

async function walkMdx(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMdx(full, base)));
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

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${DOCS_EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: texts }),
    },
  );
  if (!res.ok) {
    throw new Error(`Workers AI embed failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { result?: { data?: number[][] }; success?: boolean };
  const data = json.result?.data;
  if (!data || data.length !== texts.length) {
    throw new Error(`Unexpected embed response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return data;
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  }

  const files = (await walkMdx(DOCS_DIR)).sort();
  console.log(`Found ${files.length} doc pages under ${DOCS_DIR}`);

  // 1. Chunk every page (pure helpers shared with the agent's search_docs).
  const chunks: { id: string; page: string; heading: string; text: string }[] = [];
  for (const file of files) {
    const page = pageId(file);
    const raw = await readFile(file, "utf8");
    const { title, body } = stripMdx(raw);
    const pageChunks = chunkDocByHeading(body, title ?? page);
    pageChunks.forEach((c, i) => {
      chunks.push({ id: docChunkId(page, i), page, heading: c.heading, text: c.text });
    });
  }
  console.log(`Chunked into ${chunks.length} passages`);

  // 2. Embed in batches, then build the upsert payload.
  const vectors: DocVector[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedBatch(batch.map((c) => c.text));
    batch.forEach((c, j) => {
      const values = embeddings[j];
      if (!values) return;
      vectors.push({
        id: c.id,
        values,
        metadata: { kind: DOC_KIND, page: c.page, heading: c.heading, text: c.text },
      });
    });
    console.log(`Embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`);
  }

  // 3. Upsert via wrangler (NDJSON file). Upsert + deterministic ids = idempotent.
  const tmp = mkdtempSync(join(tmpdir(), "skillist-docs-"));
  const ndjsonPath = join(tmp, "doc-vectors.ndjson");
  writeFileSync(ndjsonPath, vectors.map((v) => JSON.stringify(v)).join("\n"));
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "vectorize",
        "upsert",
        VECTORIZE_INDEX,
        "--file",
        ndjsonPath,
        "--batch-size",
        "100",
      ],
      { cwd: API_ROOT, stdio: "inherit" },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`Upserted ${vectors.length} doc vectors into ${VECTORIZE_INDEX}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
