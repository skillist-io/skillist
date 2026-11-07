import { loadSkillCatalog, type SkillName, type SkillResourcePath } from "agents/skills";
import { describe, expect, it, vi } from "vitest";
import { parseSkillRef, skillist } from "./index";

type Published = { versionId: string; version: string; files: Record<string, string> };

const skillMd = (name: string, description = `Does ${name} things.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nInstructions.\n`;

/** A stand-in for skillist.dev's bundle route: versionId ETags, 304 on match, 404 when absent. */
function fakeDelivery(initial: Record<string, Published>) {
  const published = new Map(Object.entries(initial));
  const calls: { url: string; ifNoneMatch: string | null }[] = [];
  let down = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, ifNoneMatch: headers.get("If-None-Match") });
    if (down) throw new TypeError("network down");
    const match = /^https:\/\/skillist\.dev\/([^/]+)\/([^/]+)\/bundle$/.exec(url);
    const key = match ? `${match[1]}/${decodeURIComponent(match[2] ?? "")}` : "";
    const skill = published.get(key);
    if (!skill) return new Response('{"error":"Not found"}', { status: 404 });
    const etag = `"${skill.versionId}"`;
    if (headers.get("If-None-Match") === etag) return new Response(null, { status: 304 });
    return Response.json(
      { files: skill.files, version: skill.version },
      { headers: { ETag: etag } },
    );
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    published,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

const releaseNotes: Published = {
  versionId: "v1",
  version: "1.0.0",
  files: {
    "SKILL.md": skillMd("release-notes"),
    "references/style.md": "# Style\n",
    "scripts/collect.sh": "#!/bin/sh\necho hi\n",
    "assets/logo.png": "iVBORw0KGgo=",
  },
};

const quiet = { onWarning: () => {} };

describe("parseSkillRef", () => {
  it("parses plain, pinned, and @latest refs", () => {
    expect(parseSkillRef("acme/pdf")).toEqual({ ref: "acme/pdf", org: "acme", repo: "pdf" });
    expect(parseSkillRef("acme/pdf@1.2.0")).toMatchObject({ version: "1.2.0" });
    expect(parseSkillRef("acme/pdf@latest")).not.toHaveProperty("version");
  });

  it("rejects strings that can't form a delivery URL", () => {
    for (const bad of ["pdf", "acme/", "/pdf", "acme/pdf/extra", "acme/pd f", "acme/pdf@"]) {
      expect(() => parseSkillRef(bad)).toThrow(TypeError);
    }
  });
});

describe("skillist() source", () => {
  it("lists a published skill with typed resources", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const source = skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch });

    const result = await source.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [listed] = result.value.skills;
    expect(listed?.skill.name).toBe("release-notes");
    expect(listed?.skill.body).toContain("Instructions.");
    expect(listed?.resources).toEqual([
      { path: "assets/logo.png", kind: "asset", encoding: "base64", size: 8 },
      { path: "references/style.md", kind: "reference", encoding: "text", size: 8 },
      { path: "scripts/collect.sh", kind: "script", encoding: "text", size: 18 },
    ]);
    expect(source.id).toBe("skillist:skillist.dev");
  });

  it("revalidates with the ETag and picks up a new publish on the next list", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const source = skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch });

    await source.list();
    await source.list();
    expect(delivery.calls.map((c) => c.ifNoneMatch)).toEqual([null, '"v1"']);

    delivery.published.set("acme/release-notes", {
      versionId: "v2",
      version: "1.1.0",
      files: { "SKILL.md": skillMd("release-notes", "Now with changelog grouping.") },
    });
    const result = await source.list();
    expect(result.ok && result.value.skills[0]?.skill.description).toBe(
      "Now with changelog grouping.",
    );
  });

  it("drops a skill that starts returning 404, without serving the cached copy", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const warnings: string[] = [];
    const source = skillist({
      skills: ["acme/release-notes"],
      fetch: delivery.fetch,
      onWarning: (m) => warnings.push(m),
    });
    await source.list();

    // Retracted, or flipped to private: both surface as 404.
    delivery.published.delete("acme/release-notes");
    const result = await source.list();
    expect(result.ok && result.value.skills).toEqual([]);
    const read = await source.readResource(
      "release-notes" as SkillName,
      "references/style.md" as SkillResourcePath,
    );
    expect(read.ok).toBe(false);

    await source.list();
    expect(warnings).toHaveLength(1);
  });

  it("keeps serving the cached copy through an outage", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const source = skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch, ...quiet });
    await source.list();

    delivery.setDown(true);
    const result = await source.list();
    expect(result.ok && result.value.skills.map((s) => s.skill.name)).toEqual(["release-notes"]);
  });

  it("reports a source error when every ref fails and nothing is cached", async () => {
    const delivery = fakeDelivery({});
    delivery.setDown(true);
    const source = skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch, ...quiet });
    const result = await source.list();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("SkillSourceError");
  });

  it("fetches a pinned version once and never revalidates it", async () => {
    const delivery = fakeDelivery({ "acme/release-notes@1.0.0": releaseNotes });
    const source = skillist({ skills: ["acme/release-notes@1.0.0"], fetch: delivery.fetch });
    await source.list();
    await source.list();
    expect(delivery.calls).toHaveLength(1);
    expect(delivery.calls[0]?.url).toBe("https://skillist.dev/acme/release-notes@1.0.0/bundle");
  });

  it("keeps the first of two refs that share a skill name", async () => {
    const delivery = fakeDelivery({
      "acme/pdf": { versionId: "a", version: "1.0.0", files: { "SKILL.md": skillMd("pdf", "A.") } },
      "other/pdf": {
        versionId: "b",
        version: "1.0.0",
        files: { "SKILL.md": skillMd("pdf", "B.") },
      },
    });
    const source = skillist({ skills: ["acme/pdf", "other/pdf"], fetch: delivery.fetch, ...quiet });
    const result = await source.list();
    expect(result.ok && result.value.skills.map((s) => s.skill.description)).toEqual(["A."]);
  });

  it("reports an unparseable SKILL.md as invalid", async () => {
    const delivery = fakeDelivery({
      "acme/broken": {
        versionId: "x",
        version: "1.0.0",
        files: { "SKILL.md": "# no frontmatter" },
      },
    });
    const source = skillist({ skills: ["acme/broken"], fetch: delivery.fetch });
    const result = await source.list();
    expect(result.ok && result.value.skills).toEqual([]);
    expect(result.ok && result.value.invalid[0]?.location).toBe(
      "skillist:skillist.dev/acme/broken/SKILL.md",
    );
  });

  it("shares one round of requests between concurrent lists", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const source = skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch });
    await Promise.all([source.list(), source.list(), source.list()]);
    expect(delivery.calls).toHaveLength(1);
  });

  it("honors refreshIntervalMs", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const source = skillist({
      skills: ["acme/release-notes"],
      fetch: delivery.fetch,
      refreshIntervalMs: 60_000,
    });
    await source.list();
    await source.list();
    expect(delivery.calls).toHaveLength(1);
  });

  it("works end to end through the SDK's catalog", async () => {
    const delivery = fakeDelivery({ "acme/release-notes": releaseNotes });
    const catalog = await loadSkillCatalog([
      skillist({ skills: ["acme/release-notes"], fetch: delivery.fetch }),
    ]);

    expect(catalog.prompt()).toContain("release-notes");
    const read = await catalog.readResource({ path: "release-notes/references/style.md" });
    expect(read.ok && read.value.resource.content).toBe("# Style\n");
    const binary = await catalog.readResource({ name: "release-notes", path: "assets/logo.png" });
    expect(binary.ok && binary.value.resource.encoding).toBe("base64");
    const missing = await catalog.readResource({ name: "release-notes", path: "nope.md" });
    expect(missing.ok).toBe(false);
  });
});
