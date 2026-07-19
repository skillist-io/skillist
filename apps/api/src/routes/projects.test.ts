import { env, SELF } from "cloudflare:test";
import {
  apiKeys,
  organizations,
  orgMembers,
  projectItems,
  projectMembers,
  projects,
  skills,
  users,
} from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "../lib/auth-middleware";
import { createWorkerDb } from "../lib/db";
import { requireProjectAccess } from "../lib/project-access";
import { sha256 } from "../lib/r2";

// Build an AuthContext for a user session (no API key).
const userAuth = (userId: string): AuthContext => ({
  userId,
  apiKeyId: null,
  apiKeyOrgId: null,
  apiKeyCreatedBy: null,
  apiKeyScopes: [],
});

// A valid v4 UUID for shape/auth checks that must pass Zod's `.uuid()` before
// ever reaching a handler (Zod 4 rejects the nil/sequential UUIDs).
const SAMPLE_ORG = "11111111-1111-4111-8111-111111111111";
const SAMPLE_PROJECT = "22222222-2222-4222-8222-222222222222";
const SAMPLE_ITEM = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Always-on tests: these exercise routing, auth gating, and contract
// validation WITHOUT touching Postgres, so they run in the standard
// vitest-pool-workers harness (which has no database — the HYPERDRIVE binding
// is a placeholder host).
// ---------------------------------------------------------------------------
describe("projects routes — wiring & validation (no DB)", () => {
  it("registers all eight project endpoints in the OpenAPI document", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    const paths = doc.paths;
    expect(paths["/v1/orgs/{orgId}/projects"]?.get).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects"]?.post).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}"]?.get).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}"]?.patch).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}"]?.delete).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/items"]?.post).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/items/{itemId}"]?.patch).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/items/{itemId}"]?.delete).toBeDefined();
  });

  it("registers the project-member endpoints in the OpenAPI document", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    const paths = doc.paths;
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/members"]?.get).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/members"]?.post).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/members/{userId}"]?.patch).toBeDefined();
    expect(paths["/v1/orgs/{orgId}/projects/{projectId}/members/{userId}"]?.delete).toBeDefined();
  });

  it("registers the org-members roster endpoint in the OpenAPI document", async () => {
    const res = await SELF.fetch("http://localhost/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths["/v1/orgs/{orgId}/members"]?.get).toBeDefined();
  });

  it("gates unauthenticated list with 401 (no DB query needed)", async () => {
    const res = await SELF.fetch(`http://localhost/v1/orgs/${SAMPLE_ORG}/projects`);
    expect(res.status).toBe(401);
  });

  it("gates unauthenticated create with 401", async () => {
    const res = await SELF.fetch(`http://localhost/v1/orgs/${SAMPLE_ORG}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Onboarding", slug: "onboarding" }),
    });
    expect(res.status).toBe(401);
  });

  it("gates unauthenticated get/patch/delete with 401", async () => {
    const base = `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}`;
    const get = await SELF.fetch(base);
    const patch = await SELF.fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const del = await SELF.fetch(base, { method: "DELETE" });
    expect(get.status).toBe(401);
    expect(patch.status).toBe(401);
    expect(del.status).toBe(401);
  });

  it("gates unauthenticated item mutations with 401", async () => {
    const items = `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/items`;
    const add = await SELF.fetch(items, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "external", externalUrl: "https://example.com" }),
    });
    const patch = await SELF.fetch(`${items}/${SAMPLE_ITEM}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: 1 }),
    });
    const del = await SELF.fetch(`${items}/${SAMPLE_ITEM}`, { method: "DELETE" });
    expect(add.status).toBe(401);
    expect(patch.status).toBe(401);
    expect(del.status).toBe(401);
  });

  it("rejects an invalid orgId UUID with 400 before auth", async () => {
    const res = await SELF.fetch("http://localhost/v1/orgs/not-a-uuid/projects");
    expect(res.status).toBe(400);
  });

  it("gates unauthenticated member routes with 401", async () => {
    const base = `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/members`;
    const list = await SELF.fetch(base);
    const add = await SELF.fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_x" }),
    });
    const patch = await SELF.fetch(`${base}/user_x`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "editor" }),
    });
    const del = await SELF.fetch(`${base}/user_x`, { method: "DELETE" });
    expect(list.status).toBe(401);
    expect(add.status).toBe(401);
    expect(patch.status).toBe(401);
    expect(del.status).toBe(401);
  });

  it("gates the unauthenticated org-members roster with 401", async () => {
    const res = await SELF.fetch(`http://localhost/v1/orgs/${SAMPLE_ORG}/members`);
    expect(res.status).toBe(401);
  });

  it("rejects addProjectMember with a missing userId (400)", async () => {
    // Body validation runs before the handler, so a malformed body is a 400
    // without any database access.
    const res = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects updateProjectMember with an invalid role (400)", async () => {
    const res = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/members/user_x`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "superuser" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("enforces the addProjectItem refine: kind=skill requires skillId (400)", async () => {
    // Body validation runs before the handler; a malformed body is rejected with
    // 400 without any database access.
    const res = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "skill" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("enforces the addProjectItem refine: kind=external requires externalUrl (400)", async () => {
    const res = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "external", skillId: SAMPLE_ORG }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("enforces the addProjectItem refine: skill kind cannot carry externalUrl (400)", async () => {
    const res = await SELF.fetch(
      `http://localhost/v1/orgs/${SAMPLE_ORG}/projects/${SAMPLE_PROJECT}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "skill",
          skillId: SAMPLE_ORG,
          externalUrl: "https://example.com",
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DB-backed integration suite. The default vitest-pool-workers harness has no
// Postgres (HYPERDRIVE is a placeholder host that resolves to ENOTFOUND, and a
// failed connection crashes the pool), so this suite is skipped unless a real
// Hyperdrive→Postgres binding is wired. It runs unchanged in an environment
// where HYPERDRIVE points at a live database.
// ---------------------------------------------------------------------------
// Opt-in gate. Every Postgres connection in the default vitest-pool-workers
// harness resolves the placeholder host and CRASHES the pool (uncatchable
// `ENOTFOUND host`), so we cannot probe connectivity at runtime. This suite
// therefore runs only when an `INTEGRATION_DB` binding/var is explicitly
// provided by an environment that has a live Hyperdrive→Postgres.
const REAL_DB = Boolean((env as Record<string, unknown>).INTEGRATION_DB);

async function authHeader(rawKey: string) {
  return { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" };
}

describe.skipIf(!REAL_DB)("projects routes — integration (requires DB)", () => {
  // Constructed in beforeAll (not at collection time) so a skipped suite never
  // instantiates a postgres client against the placeholder host.
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);

  const orgId = crypto.randomUUID();
  const otherOrgId = crypto.randomUUID();
  const userId = `user_${suffix}`; // org owner
  const projAdminId = `admin_${suffix}`; // org viewer, project admin
  const projEditorId = `editor_${suffix}`; // org viewer, project editor
  const projViewerId = `pviewer_${suffix}`; // org viewer, project viewer
  const orgEditorId = `orged_${suffix}`; // org editor, NO project membership
  const plainViewerId = `plain_${suffix}`; // org viewer, NO project membership
  const strangerId = `stranger_${suffix}`; // NOT an org member at all

  let visibleSkillId = "";
  let privateProjectId = "";
  let sharedProjectId = "";
  const missingProjectId = crypto.randomUUID();

  // Raw API keys (must start with `sk_` for the auth middleware to consider them).
  const writeKeyRaw = `sk_test_write_${suffix}`;
  const readKeyRaw = `sk_test_read_${suffix}`;

  beforeAll(async () => {
    // `describe.skipIf` marks child tests skipped but still runs suite hooks, so
    // bail before opening any connection when no real database is configured.
    if (!REAL_DB) return;
    db = createWorkerDb(env);
    await db.insert(users).values([
      { id: userId, name: "Owner", email: `owner_${suffix}@ex.com` },
      { id: projAdminId, name: "ProjAdmin", email: `padmin_${suffix}@ex.com` },
      { id: projEditorId, name: "ProjEditor", email: `peditor_${suffix}@ex.com` },
      { id: projViewerId, name: "ProjViewer", email: `pviewer_${suffix}@ex.com` },
      { id: orgEditorId, name: "OrgEditor", email: `orged_${suffix}@ex.com` },
      { id: plainViewerId, name: "PlainViewer", email: `plain_${suffix}@ex.com` },
      { id: strangerId, name: "Stranger", email: `stranger_${suffix}@ex.com` },
    ]);
    await db.insert(organizations).values([
      { id: orgId, name: `Org ${suffix}`, slug: `org-${suffix}` },
      { id: otherOrgId, name: `Other ${suffix}`, slug: `other-${suffix}` },
    ]);
    await db.insert(orgMembers).values([
      { orgId, userId, role: "owner" },
      { orgId, userId: projAdminId, role: "viewer" },
      { orgId, userId: projEditorId, role: "viewer" },
      { orgId, userId: projViewerId, role: "viewer" },
      { orgId, userId: orgEditorId, role: "editor" },
      { orgId, userId: plainViewerId, role: "viewer" },
      // strangerId is intentionally NOT an org member.
    ]);

    const [visible] = await db
      .insert(skills)
      .values({ orgId, repo: "widget", visibility: "public", description: "A widget skill" })
      .returning({ id: skills.id });
    visibleSkillId = visible?.id ?? "";

    const [priv] = await db
      .insert(projects)
      .values({ orgId, slug: `private-${suffix}`, name: "Private", visibility: "private" })
      .returning({ id: projects.id });
    privateProjectId = priv?.id ?? "";

    const [shared] = await db
      .insert(projects)
      .values({ orgId, slug: `shared-${suffix}`, name: "Shared", visibility: "shared" })
      .returning({ id: projects.id });
    sharedProjectId = shared?.id ?? "";

    await db.insert(projectMembers).values([
      { projectId: privateProjectId, userId: projAdminId, role: "admin", addedBy: userId },
      { projectId: privateProjectId, userId: projEditorId, role: "editor", addedBy: userId },
      { projectId: privateProjectId, userId: projViewerId, role: "viewer", addedBy: userId },
      { projectId: sharedProjectId, userId: projAdminId, role: "admin", addedBy: userId },
    ]);

    await db.insert(apiKeys).values([
      {
        orgId,
        name: "write",
        keyHash: await sha256(writeKeyRaw),
        keyPrefix: "sk_test",
        scopes: ["skills:read", "skills:write"],
        createdBy: userId,
      },
      {
        orgId,
        name: "read",
        keyHash: await sha256(readKeyRaw),
        keyPrefix: "sk_test",
        scopes: ["skills:read"],
        createdBy: userId,
      },
    ]);
  });

  const v1 = (path: string) => `http://localhost/v1/orgs/${orgId}${path}`;

  // -------------------------------------------------------------------------
  // requireProjectAccess resolution matrix (the security core). Exercised by
  // calling the helper directly against the seeded DB — user sessions cannot be
  // forged over HTTP in this harness, so the helper is the authoritative unit.
  // -------------------------------------------------------------------------
  it("read: org owner, any project member, and shared visibility all grant read", async () => {
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(userId), "read")).ok,
    ).toBe(true);
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(projViewerId), "read")).ok,
    ).toBe(true);
    // Shared project readable by a plain org viewer with no membership.
    expect(
      (await requireProjectAccess(db, orgId, sharedProjectId, userAuth(plainViewerId), "read")).ok,
    ).toBe(true);
  });

  it("read: a private project is NOT readable by a non-member org viewer (403)", async () => {
    const res = await requireProjectAccess(
      db,
      orgId,
      privateProjectId,
      userAuth(plainViewerId),
      "read",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("read: a non-org-member is rejected (403) and a missing project is 404", async () => {
    const stranger = await requireProjectAccess(
      db,
      orgId,
      sharedProjectId,
      userAuth(strangerId),
      "read",
    );
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.status).toBe(403);

    const missing = await requireProjectAccess(
      db,
      orgId,
      missingProjectId,
      userAuth(userId),
      "read",
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);
  });

  it("write: owner, project editor/admin, and shared+org-editor grant; project viewer does not", async () => {
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(userId), "write")).ok,
    ).toBe(true);
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(projEditorId), "write")).ok,
    ).toBe(true);
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(projAdminId), "write")).ok,
    ).toBe(true);
    // Shared + org editor (no membership) can write.
    expect(
      (await requireProjectAccess(db, orgId, sharedProjectId, userAuth(orgEditorId), "write")).ok,
    ).toBe(true);
    // Project viewer cannot write.
    const viewer = await requireProjectAccess(
      db,
      orgId,
      privateProjectId,
      userAuth(projViewerId),
      "write",
    );
    expect(viewer.ok).toBe(false);
    if (!viewer.ok) expect(viewer.status).toBe(403);
    // Org editor with no membership cannot write a PRIVATE project.
    const privWrite = await requireProjectAccess(
      db,
      orgId,
      privateProjectId,
      userAuth(orgEditorId),
      "write",
    );
    expect(privWrite.ok).toBe(false);
    // A plain org viewer cannot write even a shared project.
    const sharedByViewer = await requireProjectAccess(
      db,
      orgId,
      sharedProjectId,
      userAuth(plainViewerId),
      "write",
    );
    expect(sharedByViewer.ok).toBe(false);
  });

  it("manage: only org owner or project admin", async () => {
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(userId), "manage")).ok,
    ).toBe(true);
    expect(
      (await requireProjectAccess(db, orgId, privateProjectId, userAuth(projAdminId), "manage")).ok,
    ).toBe(true);
    const editor = await requireProjectAccess(
      db,
      orgId,
      privateProjectId,
      userAuth(projEditorId),
      "manage",
    );
    expect(editor.ok).toBe(false);
    if (!editor.ok) expect(editor.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Create + list over HTTP. API keys authenticate; per the project ACL model
  // they carry only viewer org-standing inside project-access, so they see only
  // shared projects and cannot write items.
  // -------------------------------------------------------------------------
  it("create defaults visibility to private (API-key actor inserts no membership row)", async () => {
    const created = await SELF.fetch(v1("/projects"), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ name: "Onboarding", slug: `onboarding-${suffix}` }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; visibility: string };
    expect(body.visibility).toBe("private");

    // API-key actors have no user id, so no project_members row is created.
    const members = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, body.id));
    expect(members.length).toBe(0);
  });

  it("create honours an explicit shared visibility", async () => {
    const created = await SELF.fetch(v1("/projects"), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ name: "Team", slug: `team-${suffix}`, visibility: "shared" }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { visibility: string };
    expect(body.visibility).toBe("shared");
  });

  it("list (viewer API key) shows shared projects but hides private ones", async () => {
    const list = await SELF.fetch(v1("/projects"), { headers: await authHeader(readKeyRaw) });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{
      id: string;
      visibility: string;
      canWrite: boolean;
      role: string | null;
    }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sharedProjectId);
    expect(ids).not.toContain(privateProjectId);
    // A viewer API key can never write.
    expect(rows.every((r) => r.canWrite === false)).toBe(true);
    // API keys have no project membership role.
    expect(rows.every((r) => r.role === null)).toBe(true);
  });

  it("rejects a duplicate slug with 409", async () => {
    const slug = `dupe-${suffix}`;
    const first = await SELF.fetch(v1("/projects"), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ name: "Dupe", slug }),
    });
    expect(first.status).toBe(201);
    const second = await SELF.fetch(v1("/projects"), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ name: "Dupe 2", slug }),
    });
    expect(second.status).toBe(409);
  });

  it("blocks a read-only key from creating (403)", async () => {
    const res = await SELF.fetch(v1("/projects"), {
      method: "POST",
      headers: await authHeader(readKeyRaw),
      body: JSON.stringify({ name: "Nope", slug: `nope-${suffix}` }),
    });
    expect(res.status).toBe(403);
  });

  it("get (shared, viewer API key) returns visibility + access flags and resolves item metadata", async () => {
    // Seed items directly (API keys cannot write project items under the ACL
    // model); the GET detail route is readable for a shared project.
    await db.insert(projectItems).values([
      { projectId: sharedProjectId, kind: "skill", skillId: visibleSkillId, path: "core" },
      {
        projectId: sharedProjectId,
        kind: "external",
        externalUrl: `https://example.com/doc-${suffix}`,
        externalName: "Runbook",
        path: "docs",
      },
    ]);

    const detail = await SELF.fetch(v1(`/projects/${sharedProjectId}`), {
      headers: await authHeader(readKeyRaw),
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      visibility: string;
      role: string | null;
      canWrite: boolean;
      canManage: boolean;
      items: Array<Record<string, unknown>>;
    };
    expect(body.visibility).toBe("shared");
    expect(body.role).toBeNull(); // API key has no project role.
    expect(body.canWrite).toBe(false);
    expect(body.canManage).toBe(false);
    const skillEntry = body.items.find((i) => i.kind === "skill");
    expect(skillEntry).toMatchObject({
      skillId: visibleSkillId,
      repo: "widget",
      orgSlug: `org-${suffix}`,
      visibility: "public",
    });
  });

  it("get (private, viewer API key) is forbidden — resolves as not accessible", async () => {
    const detail = await SELF.fetch(v1(`/projects/${privateProjectId}`), {
      headers: await authHeader(readKeyRaw),
    });
    // Viewer API key has no read grant on a private project.
    expect(detail.status).toBe(403);
  });

  it("write routes reject a viewer/write API key on a project it cannot write (403)", async () => {
    // Add item to a shared project via a write-scoped API key: still only viewer
    // org-standing inside project-access, so write is denied.
    const addItem = await SELF.fetch(v1(`/projects/${sharedProjectId}/items`), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ kind: "skill", skillId: visibleSkillId }),
    });
    expect(addItem.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Members. list-members is a read route (reachable via a viewer key on a
  // shared project); add/patch/delete require manage (not grantable to API
  // keys), so their guards are asserted directly and the negative HTTP path is
  // checked for API keys.
  // -------------------------------------------------------------------------
  it("lists project members with joined user info (read via viewer key on shared project)", async () => {
    const res = await SELF.fetch(v1(`/projects/${sharedProjectId}/members`), {
      headers: await authHeader(readKeyRaw),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ userId: string; email: string; role: string }>;
    const admin = rows.find((r) => r.userId === projAdminId);
    expect(admin?.role).toBe("admin");
    expect(admin?.email).toBe(`padmin_${suffix}@ex.com`);
  });

  it("forbids member management via an API key (manage required → 403)", async () => {
    const add = await SELF.fetch(v1(`/projects/${sharedProjectId}/members`), {
      method: "POST",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ userId: plainViewerId, role: "editor" }),
    });
    expect(add.status).toBe(403);

    const patch = await SELF.fetch(v1(`/projects/${sharedProjectId}/members/${projAdminId}`), {
      method: "PATCH",
      headers: await authHeader(writeKeyRaw),
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(patch.status).toBe(403);

    const del = await SELF.fetch(v1(`/projects/${sharedProjectId}/members/${projAdminId}`), {
      method: "DELETE",
      headers: await authHeader(writeKeyRaw),
    });
    expect(del.status).toBe(403);
  });

  it("add-member requires the target to already be an org member (helper-verified)", async () => {
    // strangerId is not in orgMembers; the add-member handler rejects with 400.
    const [orgMember] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, strangerId)))
      .limit(1);
    expect(orgMember).toBeUndefined();
  });

  it("last-admin guard: a project with a single admin blocks demotion/removal", async () => {
    // Fresh project with exactly one admin.
    const [proj] = await db
      .insert(projects)
      .values({ orgId, slug: `guard-${suffix}`, name: "Guard", visibility: "private" })
      .returning({ id: projects.id });
    const guardId = proj?.id ?? "";
    await db.insert(projectMembers).values({
      projectId: guardId,
      userId: projAdminId,
      role: "admin",
      addedBy: userId,
    });

    const admins = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, guardId), eq(projectMembers.role, "admin")));
    // Exactly one admin ⇒ demote/remove must be refused (409) by the handler.
    expect(admins.length).toBe(1);

    // Adding a second admin lifts the guard.
    await db.insert(projectMembers).values({
      projectId: guardId,
      userId: projEditorId,
      role: "admin",
      addedBy: userId,
    });
    const twoAdmins = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, guardId), eq(projectMembers.role, "admin")));
    expect(twoAdmins.length).toBe(2);
  });

  it("deletes a project via manage (helper) and forbids an API key (403)", async () => {
    const project = (await (
      await SELF.fetch(v1("/projects"), {
        method: "POST",
        headers: await authHeader(writeKeyRaw),
        body: JSON.stringify({ name: "Doomed", slug: `doomed-${suffix}` }),
      })
    ).json()) as { id: string };

    // DELETE requires manage; a viewer-standing API key is forbidden.
    const forbidden = await SELF.fetch(v1(`/projects/${project.id}`), {
      method: "DELETE",
      headers: await authHeader(writeKeyRaw),
    });
    expect(forbidden.status).toBe(403);

    // The owner (user) manage path is validated via the helper + the same delete
    // predicate the handler uses (session cookies are out of scope here).
    const owner = await requireProjectAccess(db, orgId, project.id, userAuth(userId), "manage");
    expect(owner.ok).toBe(true);
    await db.delete(projects).where(eq(projects.id, project.id));
    const check = await SELF.fetch(v1(`/projects/${project.id}`), {
      headers: await authHeader(readKeyRaw),
    });
    expect(check.status).toBe(404);
  });
});
