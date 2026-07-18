import { env } from "cloudflare:test";
import { encodeBase64, objectToBundle } from "@skillist/skill-format";
import { describe, expect, it } from "vitest";
import { downloadBundleFromR2, listBundlePaths, r2Prefix, uploadBundleToR2 } from "./r2";

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
