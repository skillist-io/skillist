import { describe, expect, it } from "vitest";
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
