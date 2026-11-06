import { env } from "cloudflare:test";
import { encodeBase64, objectToBundle } from "@skillist/skill-format";
import { describe, expect, it } from "vitest";
import {
  bundleFileManifest,
  downloadBundleFromR2,
  listBundlePaths,
  r2Prefix,
  uploadBundleToR2,
} from "./r2";

describe("R2 binary asset round trip", () => {
  it("stores decoded bytes in R2 and returns base64 text on download", async () => {
    const prefix = r2Prefix("org-1", "r2-binary-test", crypto.randomUUID());
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 255]);
    const bundle = objectToBundle({
      "SKILL.md": "---\nname: r2-binary-test\ndescription: test\n---\nbody",
      "assets/logo.png": encodeBase64(pngBytes),
    });

    await uploadBundleToR2(env.SKILLS_R2, prefix, bundle);

    // The R2 object itself holds real decoded bytes, not the base64 text.
    const raw = await env.SKILLS_R2.get(`${prefix}/assets/logo.png`);
    expect(raw).not.toBeNull();
    expect(new Uint8Array(await raw!.arrayBuffer())).toEqual(pngBytes);
    expect(raw!.httpMetadata?.contentType).toBe("image/png");

    const paths = await listBundlePaths(env.SKILLS_R2, prefix);
    expect(paths.sort()).toEqual(["SKILL.md", "assets/logo.png"]);

    const downloaded = await downloadBundleFromR2(env.SKILLS_R2, prefix, paths);
    expect(downloaded.get("assets/logo.png")).toBe(encodeBase64(pngBytes));
    expect(downloaded.get("SKILL.md")).toBe(bundle.get("SKILL.md"));
  });
});

describe("bundleFileManifest", () => {
  // Hashes the object R2 actually returns, independently of the code under
  // test: a host verifies what it was served, so that is the source of truth.
  async function storedDigest(key: string) {
    const obj = await env.SKILLS_R2.get(key);
    const bytes = new Uint8Array(await obj!.arrayBuffer());
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      sha256: [...hash].map((b) => b.toString(16).padStart(2, "0")).join(""),
      size: bytes.byteLength,
    };
  }

  it("describes the stored bytes for non-ASCII text and binary assets", async () => {
    const prefix = r2Prefix("org-1", "r2-manifest-test", crypto.randomUUID());
    const skillMd = "---\nname: r2-manifest-test\ndescription: test\n---\ncafé 🚀 日本語";
    const logo = encodeBase64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 255]));
    const bundle = objectToBundle({ "SKILL.md": skillMd, "assets/logo.png": logo });

    await uploadBundleToR2(env.SKILLS_R2, prefix, bundle);

    for (const [path, content] of bundle) {
      expect(await bundleFileManifest(path, content)).toEqual({
        path,
        ...(await storedDigest(`${prefix}/${path}`)),
      });
    }

    // Guards the two original bugs directly: neither figure is the string length.
    expect((await bundleFileManifest("SKILL.md", skillMd)).size).toBeGreaterThan(skillMd.length);
    expect((await bundleFileManifest("assets/logo.png", logo)).size).toBe(12);
  });
});
