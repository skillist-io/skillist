import type { SkillBundle } from "@skillist/skill-format";
import { tarballCacheKey } from "./cache";

const TAR_BLOCK = 512;
const MAX_TARBALL_BYTES = 80 * 1024 * 1024;

type TarEntry = { path: string; content: Uint8Array };

function readTarString(header: Uint8Array, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  const bytes = end === -1 ? slice : slice.subarray(0, end);
  return new TextDecoder().decode(bytes).trim();
}

/** Parse ustar tar entries from decompressed GitHub tarball bytes. */
export function parseTarEntries(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + TAR_BLOCK <= data.length) {
    const header = data.subarray(offset, offset + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const size = Number.parseInt(readTarString(header, 124, 12), 8) || 0;
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;

    offset += TAR_BLOCK;
    if (size > 0 && path) {
      entries.push({
        path,
        content: data.slice(offset, offset + size),
      });
    }
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }

  return entries;
}

/** Extract a skill folder from parsed tarball paths (GitHub root prefix stripped). */
export function extractSkillBundleFromTarEntries(
  entries: TarEntry[],
  sourcePath: string,
): SkillBundle {
  const bundle: SkillBundle = new Map();
  if (!entries.length) return bundle;

  const firstEntry = entries[0];
  if (!firstEntry) return bundle;
  const rootPrefix = `${firstEntry.path.split("/")[0]}/`;
  const skillPrefix = `${rootPrefix}${sourcePath}/`;

  for (const entry of entries) {
    if (!entry.path.startsWith(skillPrefix)) continue;
    const relative = entry.path.slice(skillPrefix.length);
    if (!relative || relative.startsWith(".")) continue;
    bundle.set(relative, new TextDecoder().decode(entry.content));
  }

  return bundle;
}

async function decompressGzip(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Load a skill bundle from a cached GitHub tarball in R2 (no per-blob GitHub API calls).
 * Returns null when tarball is missing or too large to parse in-memory.
 */
export async function loadSkillBundleFromTarball(
  bucket: R2Bucket,
  owner: string,
  repo: string,
  commitSha: string,
  sourcePath: string,
): Promise<SkillBundle | null> {
  const key = tarballCacheKey(owner, repo, commitSha);
  const head = await bucket.head(key);
  if (!head) return null;
  if (head.size && head.size > MAX_TARBALL_BYTES) return null;

  const obj = await bucket.get(key);
  if (!obj) return null;

  const entries = parseTarEntries(await decompressGzip(await obj.arrayBuffer()));
  const bundle = extractSkillBundleFromTarEntries(entries, sourcePath);
  return bundle.has("SKILL.md") ? bundle : null;
}
