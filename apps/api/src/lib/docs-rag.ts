import type { Env } from "../env";

/** BGE base — 768-dim embeddings, the same model failure-mining uses. */
export const DOCS_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Discriminator stored on every doc vector's metadata so doc chunks share the
 * existing `skillist-failures` Vectorize index without colliding with the
 * failure-mining vectors (which carry `skillId`/`signature` and no `kind`).
 * Filter queries with `{ kind: DOC_KIND }` to read only doc chunks.
 *
 * NOTE: filtering on `kind` requires a Vectorize metadata index:
 *   wrangler vectorize create-metadata-index skillist-failures \
 *     --property-name=kind --type=string
 */
export const DOC_KIND = "doc";

/** A single embeddable slice of a docs page. */
export type DocChunk = {
  /** Doc page path relative to the docs content root, e.g. "platform/coverage". */
  page: string;
  /** Nearest preceding heading text (or the page title for the lead chunk). */
  heading: string;
  /** Plain-text chunk body (frontmatter + MDX stripped). */
  text: string;
};

/** A doc chunk returned from a Vectorize similarity search. */
export type DocSearchHit = DocChunk & { score: number };

/**
 * Strips YAML frontmatter and MDX scaffolding (import lines, JSX component tags)
 * from a raw `.mdx` file, leaving prose + headings + code the model can read.
 * Returns the page title parsed from frontmatter when present.
 */
export function stripMdx(raw: string): { title: string | null; body: string } {
  let title: string | null = null;
  let body = raw;

  // Pull the frontmatter block and lift `title:` out of it.
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    const titleMatch = fmMatch[1]?.match(/^title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
    body = body.slice(fmMatch[0].length);
  }

  body = body
    // ESM import/export lines used to pull in doc components.
    .replace(/^\s*(import|export)\s+.*$/gm, "")
    // Self-closing or paired JSX component tags (<DocAlert .../>, </DocTable>).
    .replace(/<\/?[A-Z][\w.]*(\s[^>]*)?\/?>/g, "")
    // Collapse the runs of blank lines the strips leave behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, body };
}

/** Rough token estimate (~4 chars/token) — good enough for chunk sizing. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits a stripped doc body into heading-anchored chunks of roughly
 * `maxTokens` tokens. Each Markdown heading starts a new logical section; long
 * sections are further split on paragraph boundaries so no chunk blows past the
 * embedding model's context. Deterministic: the same input yields the same
 * chunks (so re-seeding overwrites rather than duplicates).
 */
export function chunkDocByHeading(
  body: string,
  fallbackHeading: string,
  maxTokens = 700,
): DocChunk[] {
  const lines = body.split("\n");
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } = { heading: fallbackHeading, lines: [] };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      if (current.lines.some((l) => l.trim())) sections.push(current);
      current = { heading: headingMatch[1]?.trim() || fallbackHeading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);

  const chunks: DocChunk[] = [];
  for (const section of sections) {
    const paragraphs = section.lines
      .join("\n")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    let buf: string[] = [];
    const flush = () => {
      const text = buf.join("\n\n").trim();
      if (text) chunks.push({ page: "", heading: section.heading, text });
      buf = [];
    };
    for (const para of paragraphs) {
      const candidate = [...buf, para].join("\n\n");
      if (buf.length > 0 && approxTokens(candidate) > maxTokens) flush();
      buf.push(para);
    }
    flush();
  }
  return chunks;
}

/** Deterministic Vectorize id for a chunk, so re-seeding upserts in place. */
export function docChunkId(page: string, index: number): string {
  return `doc:${page}#${index}`;
}

/**
 * Embeds a single text into a 768-dim vector via Workers AI (BGE base). Returns
 * `[]` when the model yields no data so callers can skip rather than upserting a
 * degenerate vector.
 */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const res = (await env.AI.run(DOCS_EMBEDDING_MODEL, { text: [trimmed] })) as {
    data?: number[][];
  };
  return res.data?.[0] ?? [];
}

/**
 * RAG over Skillist's own docs: embeds the query and returns the top-K doc
 * chunks from Vectorize (filtered to doc vectors), each with its source page and
 * heading so the agent can cite where an answer came from. Requires `env.AI` +
 * `env.VECTORIZE`, so it cannot run in the vitest-pool-workers harness.
 */
export async function searchDocs(env: Env, query: string, limit = 5): Promise<DocSearchHit[]> {
  const values = await embedText(env, query);
  if (values.length === 0) return [];

  const topK = Math.min(Math.max(limit, 1), 10);
  const result = await env.VECTORIZE.query(values, {
    topK,
    filter: { kind: DOC_KIND },
    returnMetadata: "all",
  });

  return result.matches.flatMap((match) => {
    const meta = match.metadata ?? {};
    const text = typeof meta.text === "string" ? meta.text : "";
    if (!text) return [];
    return [
      {
        page: typeof meta.page === "string" ? meta.page : "",
        heading: typeof meta.heading === "string" ? meta.heading : "",
        text,
        score: match.score,
      },
    ];
  });
}
