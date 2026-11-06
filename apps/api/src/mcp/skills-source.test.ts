import { env } from "cloudflare:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  orgMembers,
  projectItems,
  projects,
  skillFiles,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import { encodeBase64, objectToBundle, type SkillBundle } from "@skillist/skill-format";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bundleFileManifest, r2Prefix, uploadBundleToR2 } from "../lib/r2";
import { seedOrg, seedUser, testDb } from "../test-support/db";
import { buildRegistryMcpServer, MCP_PROTOCOL_VERSION } from "./registry-server";
import type { McpSession } from "./transport";

type Db = ReturnType<typeof testDb>;

const sessionFor = (userId: string): McpSession => ({
  accessToken: "t",
  refreshToken: "t",
  accessTokenExpiresAt: "",
  refreshTokenExpiresAt: "",
  clientId: "c",
  userId,
  scopes: "",
});

async function rpc(
  db: Db,
  session: McpSession | null,
  method: string,
  params: Record<string, unknown> = {},
) {
  const handler = createMcpHandler(() => buildRegistryMcpServer(db, session, env.SKILLS_R2), {
    responseMode: "json",
  });
  const response = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "Mcp-Method": method,
        ...(typeof params.uri === "string" ? { "Mcp-Name": params.uri } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }),
  );
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC envelopes vary by method.
  return (await response.json()) as any;
}

async function seedSkill(
  db: Db,
  orgId: string,
  repo: string,
  bundle: SkillBundle,
  options: { visibility?: "public" | "private"; status?: "published" | "draft" } = {},
) {
  const [skill] = await db
    .insert(skills)
    .values({ orgId, repo, visibility: options.visibility ?? "public" })
    .returning();
  if (!skill) throw new Error("no skill");
  const prefix = r2Prefix(orgId, repo, crypto.randomUUID());
  await uploadBundleToR2(env.SKILLS_R2, prefix, bundle);
  const [version] = await db
    .insert(skillVersions)
    .values({
      skillId: skill.id,
      status: options.status ?? "published",
      semver: "1.0.0",
      r2Prefix: prefix,
    })
    .returning();
  if (!version) throw new Error("no version");
  const rows = await Promise.all(
    [...bundle].map(async ([path, content]) => ({
      versionId: version.id,
      ...(await bundleFileManifest(path, content)),
    })),
  );
  await db.insert(skillFiles).values(rows);
  await db
    .update(skills)
    .set({ latestPublishedVersionId: version.id })
    .where(eq(skills.id, skill.id));
  return skill;
}

const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: Café review 🚀\nlicense: MIT\n---\n\n# 日本語\n`;

async function seedRegistry(db: Db) {
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id);
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 255]);
  const listed = await seedSkill(
    db,
    org.id,
    "listed",
    objectToBundle({
      "SKILL.md": skillMd("listed"),
      "references/guide.md": "\uFEFF# Guide — naïve\n",
      "assets/logo.png": encodeBase64(pngBytes),
    }),
  );
  await seedSkill(db, org.id, "unlisted", objectToBundle({ "SKILL.md": skillMd("unlisted") }));
  const hidden = await seedSkill(
    db,
    org.id,
    "hidden",
    objectToBundle({ "SKILL.md": skillMd("hidden") }),
    { visibility: "private" },
  );
  await seedSkill(db, org.id, "draft", objectToBundle({ "SKILL.md": skillMd("draft") }), {
    status: "draft",
  });

  const [project] = await db
    .insert(projects)
    .values({ orgId: org.id, slug: "team", name: "Team" })
    .returning();
  if (!project) throw new Error("no project");
  await db.insert(projectItems).values([
    { projectId: project.id, kind: "skill", skillId: listed.id, path: "" },
    { projectId: project.id, kind: "skill", skillId: hidden.id, path: "" },
  ]);
  return {
    owner,
    org,
    pngBytes,
    uri: (repo: string, path = "SKILL.md") => `skill://${org.slug}/${repo}/${path}`,
  };
}

async function digestOf(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...hash].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Recovers raw bytes from a read result the way a host does, for either encoding. */
function contentBytes(content: { text?: string; blob?: string }) {
  if (content.text !== undefined) return new TextEncoder().encode(content.text);
  return Uint8Array.from(atob(content.blob ?? ""), (c) => c.charCodeAt(0));
}

describe("Skills extension", () => {
  it("declares the extension and resources in server/discover", async () => {
    const body = await rpc(testDb(), null, "server/discover");
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.capabilities.extensions).toHaveProperty(["io.modelcontextprotocol/skills"]);
  });

  it("serves a manifest that every file verifies against", async () => {
    const db = testDb();
    const { uri, pngBytes } = await seedRegistry(db);

    const { result } = await rpc(db, null, "skills/get", { uri: uri("listed") });
    expect(result.skill.uri).toBe(uri("listed"));
    expect(result.skill.frontmatter).toEqual({
      name: "listed",
      description: "Café review 🚀",
      license: "MIT",
    });
    expect(result.skill.resources).toHaveLength(3);

    for (const entry of result.skill.resources) {
      const read = await rpc(db, null, "resources/read", { uri: entry.uri });
      const bytes = contentBytes(read.result.contents[0]);
      expect(bytes.byteLength).toBe(entry.size);
      expect(await digestOf(bytes)).toBe(entry.digest);
    }

    const logo = await rpc(db, null, "resources/read", { uri: uri("listed", "assets/logo.png") });
    expect(contentBytes(logo.result.contents[0])).toEqual(pngBytes);
    expect(logo.result.contents[0].mimeType).toBe("image/png");
  });

  it("refuses private, unpublished and unknown skills", async () => {
    const db = testDb();
    const { uri } = await seedRegistry(db);

    for (const target of [uri("hidden"), uri("draft"), uri("missing")]) {
      const got = await rpc(db, null, "skills/get", { uri: target });
      expect(got.error?.code).toBe(-32602);
      const read = await rpc(db, null, "resources/read", { uri: target });
      expect(read.result).toBeUndefined();
      expect(read.error).toBeDefined();
    }
  });

  it("does not read paths outside the manifest", async () => {
    const db = testDb();
    const { org, uri } = await seedRegistry(db);

    // A real object beside the bundle, so only the manifest check can refuse it.
    const [version] = await db
      .select({ r2Prefix: skillVersions.r2Prefix })
      .from(skillVersions)
      .innerJoin(skills, eq(skills.latestPublishedVersionId, skillVersions.id))
      .where(and(eq(skills.orgId, org.id), eq(skills.repo, "listed")));
    await env.SKILLS_R2.put(`${version?.r2Prefix}/references/unlisted.md`, "not in the manifest");

    for (const path of ["references/unlisted.md", "../hidden/SKILL.md", "references"]) {
      const read = await rpc(db, null, "resources/read", { uri: uri("listed", path) });
      expect(read.result).toBeUndefined();
      expect(read.error).toBeDefined();
    }
  });

  it("lists nothing anonymously, publicly cacheable", async () => {
    const db = testDb();
    await seedRegistry(db);
    const { result } = await rpc(db, null, "skills/list");
    expect(result.skills).toEqual([]);
    expect(result.cacheScope).toBe("public");
  });

  it("lists only public skills from readable projects, privately cached", async () => {
    const db = testDb();
    const { owner, uri } = await seedRegistry(db);

    const { result } = await rpc(db, sessionFor(owner.id), "skills/list");
    expect(result.skills.map((s: { uri: string }) => s.uri)).toEqual([uri("listed")]);
    expect(result.cacheScope).toBe("private");
    expect(result.ttlMs).toBe(0);
  });

  it("hides a private project's skills from a non-owner member of the org", async () => {
    const db = testDb();
    const { org } = await seedRegistry(db);
    const member = await seedUser(db);
    await db.insert(orgMembers).values({ orgId: org.id, userId: member.id, role: "viewer" });

    const { result } = await rpc(db, sessionFor(member.id), "skills/list");
    expect(result.skills).toEqual([]);
  });

  it("lists nothing for a user in no org", async () => {
    const db = testDb();
    await seedRegistry(db);
    const stranger = await seedUser(db);
    const { result } = await rpc(db, sessionFor(stranger.id), "skills/list");
    expect(result.skills).toEqual([]);
  });
});
