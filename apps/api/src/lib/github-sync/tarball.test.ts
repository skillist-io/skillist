import { decodeBase64, validateSkillBundle } from "@skillist/skill-format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleFileManifest } from "../r2";
import { loadSkillBundleFromTree } from "./bundle";
import { extractSkillBundleFromTarEntries, parseTarEntries } from "./tarball";

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  enc.encodeInto(name, header);
  const sizeOct = size.toString(8).padStart(11, "0");
  enc.encodeInto(sizeOct, header.subarray(124));
  header[156] = "0".charCodeAt(0); // typeflag: regular file
  return header;
}

function buildTar(files: { path: string; content: string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    const content = new TextEncoder().encode(file.content);
    chunks.push(tarHeader(file.path, content.byteLength));
    chunks.push(content);
    const pad = Math.ceil(content.byteLength / 512) * 512 - content.byteLength;
    if (pad > 0) chunks.push(new Uint8Array(pad));
  }
  chunks.push(new Uint8Array(512));
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("parseTarEntries", () => {
  it("extracts file paths and contents", () => {
    const tar = buildTar([
      { path: "repo-root/skills/foo/SKILL.md", content: "---\nname: foo\n---\n" },
    ]);
    const entries = parseTarEntries(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("repo-root/skills/foo/SKILL.md");
  });
});

describe("extractSkillBundleFromTarEntries", () => {
  it("maps tarball paths to bundle relative paths", () => {
    const entries = parseTarEntries(
      buildTar([
        { path: "cf-skills-abc/skills/agents-sdk/SKILL.md", content: "skill" },
        { path: "cf-skills-abc/skills/agents-sdk/scripts/run.sh", content: "#!/bin/sh" },
      ]),
    );
    const bundle = extractSkillBundleFromTarEntries(entries, "skills/agents-sdk");
    expect(bundle.get("SKILL.md")).toBe("skill");
    expect(bundle.get("scripts/run.sh")).toBe("#!/bin/sh");
  });
});

// Not valid UTF-8 (0x89, 0xFF), so a lossy decode can't reproduce these bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
const GZIP_BYTES = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe]);
const SKILL_MD = "---\nname: demo\ndescription: A demo skill for binary mirroring.\n---\n\nBody\n";

const encode = (text: string) => new TextEncoder().encode(text);

/** Each way a mirrored bundle gets loaded. They have to agree on what bytes become. */
const loaders: [string, (files: Record<string, Uint8Array>) => Promise<Map<string, string>>][] = [
  [
    "tarball",
    async (files) =>
      extractSkillBundleFromTarEntries(
        Object.entries(files).map(([path, content]) => ({
          path: `root-abc/skills/demo/${path}`,
          content,
        })),
        "skills/demo",
      ),
  ],
  [
    "GitHub tree",
    async (files) => {
      const paths = Object.keys(files);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const sha = String(input).split("/").pop()!;
        const bytes = files[paths[Number(sha)]!]!;
        const content = btoa(String.fromCharCode(...bytes));
        return Response.json({ content, encoding: "base64" });
      });
      return loadSkillBundleFromTree(
        "owner",
        "repo",
        paths.map((path, index) => ({
          path: `skills/demo/${path}`,
          type: "blob",
          sha: String(index),
          size: files[path]!.byteLength,
        })),
        "skills/demo",
      );
    },
  ],
];

describe.each(loaders)("mirrored file contents via %s", (_name, load) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps binary assets byte-exact, so the skill validates and its manifest is true", async () => {
    const bundle = await load({ "SKILL.md": encode(SKILL_MD), "assets/logo.png": PNG_BYTES });

    expect(validateSkillBundle(bundle, "demo").valid).toBe(true);
    const content = bundle.get("assets/logo.png")!;
    expect(decodeBase64(content)).toEqual(PNG_BYTES);
    expect((await bundleFileManifest("assets/logo.png", content)).size).toBe(PNG_BYTES.byteLength);
  });

  it("drops a file that is neither a known binary type nor valid UTF-8", async () => {
    const bundle = await load({
      "SKILL.md": encode(SKILL_MD),
      "scripts/components.tar.gz": GZIP_BYTES,
    });

    expect([...bundle.keys()]).toEqual(["SKILL.md"]);
  });

  it("leaves text files as they were, including non-ASCII", async () => {
    const text = "# Résumé ✓\n";
    const bundle = await load({ "SKILL.md": encode(SKILL_MD), "references/a.md": encode(text) });

    expect(bundle.get("references/a.md")).toBe(text);
  });
});
