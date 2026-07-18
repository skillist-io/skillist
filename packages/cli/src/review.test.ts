import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalBundle } from "./review.js";

describe("readLocalBundle", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("base64-encodes binary asset files and reads text files as-is", async () => {
    dir = await mkdtemp(join(tmpdir(), "skillist-review-"));
    await writeFile(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\nbody", "utf8");
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "assets", "logo.png"), pngBytes);

    const files = await readLocalBundle(dir);

    expect(files.get("SKILL.md")).toContain("name: x");
    expect(files.get("assets/logo.png")).toBe(pngBytes.toString("base64"));
    // Round-trips back to the exact original bytes.
    expect(Buffer.from(files.get("assets/logo.png")!, "base64")).toEqual(pngBytes);
  });
});
