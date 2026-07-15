import {
  bundleToObject,
  objectToBundle,
  type SkillBundle,
} from "@skillist/skill-format";

export function r2Prefix(
  orgId: string,
  skillSlug: string,
  versionId: string,
): string {
  return `orgs/${orgId}/skills/${skillSlug}/v/${versionId}`;
}

export async function uploadBundleToR2(
  bucket: R2Bucket,
  prefix: string,
  files: SkillBundle,
): Promise<void> {
  const uploads = [...files.entries()].map(([path, content]) =>
    bucket.put(`${prefix}/${path}`, content, {
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
      if (obj) {
        bundle.set(path, await obj.text());
      }
    }),
  );
  return bundle;
}

export async function listBundlePaths(
  bucket: R2Bucket,
  prefix: string,
): Promise<string[]> {
  const listed = await bucket.list({ prefix: `${prefix}/` });
  return listed.objects.map((o) => o.key.replace(`${prefix}/`, ""));
}

function contentTypeForPath(path: string): string {
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
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { bundleToObject, objectToBundle };
