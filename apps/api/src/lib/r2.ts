import {
  binaryAssetMimeType,
  bundleToObject,
  decodeBase64,
  encodeBase64,
  isBinaryAssetPath,
  objectToBundle,
  type SkillBundle,
} from "@skillist/skill-format";

export function r2Prefix(orgId: string, skillRepo: string, versionId: string): string {
  return `orgs/${orgId}/skills/${skillRepo}/v/${versionId}`;
}

// Binary assets are represented as base64 text in the SkillBundle map (see
// @skillist/skill-format/binary) but stored as real decoded bytes in R2, so
// the object is genuinely the image/PDF/whatever — correct Content-Type,
// servable directly if anything ever reads R2 without going through this
// encode/decode boundary.
export async function uploadBundleToR2(
  bucket: R2Bucket,
  prefix: string,
  files: SkillBundle,
): Promise<void> {
  const uploads = [...files.entries()].map(([path, content]) =>
    bucket.put(`${prefix}/${path}`, isBinaryAssetPath(path) ? decodeBase64(content) : content, {
      httpMetadata: { contentType: contentTypeForPath(path) },
    }),
  );
  await Promise.all(uploads);
}

export async function downloadBundleFromR2(
  bucket: R2Bucket,
  prefix: string,
  paths: string[],
): Promise<SkillBundle> {
  const bundle: SkillBundle = new Map();
  await Promise.all(
    paths.map(async (path) => {
      const obj = await bucket.get(`${prefix}/${path}`);
      if (!obj) return;
      if (isBinaryAssetPath(path)) {
        bundle.set(path, encodeBase64(new Uint8Array(await obj.arrayBuffer())));
      } else {
        bundle.set(path, await obj.text());
      }
    }),
  );
  return bundle;
}

/**
 * Key of the materialized bundle object — the exact `{files, version}` JSON
 * the /bundle delivery route serves, assembled once at publish instead of on
 * every request. A sibling of the `${prefix}/` file tree (no slash), so it can
 * never collide with a bundle file path and never shows up in listBundlePaths.
 */
export function bundleObjectKey(r2Prefix: string): string {
  return `${r2Prefix}.bundle.json`;
}

export async function putBundleObject(
  bucket: R2Bucket,
  r2Prefix: string,
  files: SkillBundle,
  version: string,
): Promise<string> {
  const key = bundleObjectKey(r2Prefix);
  await bucket.put(key, JSON.stringify({ files: bundleToObject(files), version }), {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}

export async function listBundlePaths(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const listed = await bucket.list({ prefix: `${prefix}/` });
  return listed.objects.map((o) => o.key.replace(`${prefix}/`, ""));
}

function contentTypeForPath(path: string): string {
  if (isBinaryAssetPath(path)) return binaryAssetMimeType(path);
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".py")) return "text/x-python";
  if (path.endsWith(".sh")) return "text/x-shellscript";
  if (path.endsWith(".js") || path.endsWith(".ts")) return "text/javascript";
  return "text/plain";
}

export async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { bundleToObject, objectToBundle };
