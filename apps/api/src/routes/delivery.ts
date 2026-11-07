import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { createWorkerDb } from "../lib/db";
import {
  parseRepoSpecifier,
  serveSkillBundle,
  serveSkillMd,
  serveSkillMdAtVersion,
  serveSkillMeta,
  serveSkillMetaAtVersion,
} from "../lib/delivery";
import { errorResponses } from "../lib/openapi";

type AppEnv = {
  Bindings: Env;
  Variables: { auth?: AuthContext; db?: WorkerDb };
};

export const deliveryRoutes = new OpenAPIHono<AppEnv>();

// The {repo} segment optionally carries a version pin: `widget` or
// `widget@latest` (mutable latest) or `widget@1.2.3` (immutable exact
// version). Malformed pins 404 in the handlers via parseRepoSpecifier.
const orgRepoParams = z.object({
  org: z.string().min(1),
  repo: z.string().min(1),
});

/**
 * The public projection of the KV meta entry (`SkillKvMeta` in lib/kv.ts) —
 * `bundleKey` is stripped by the handler as an internal storage pointer.
 */
const skillMetaResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  versionId: z.string(),
  etag: z.string(),
  org: z.string(),
  repo: z.string(),
  publishedAt: z.string(),
  visibility: z.enum(["private", "org", "public"]).optional(),
  sourceType: z.enum(["native", "mirror"]).optional(),
  upstreamRepo: z.string().optional(),
  upstreamUrl: z.string().optional(),
  contentSha256: z.string().optional(),
});

function badSpecifier(): Response {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "public, max-age=30" } },
  );
}

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * Lazy DB accessor for the delivery routes.
 *
 * These are public and NOT behind authMiddleware, so `c.var.db` is normally
 * undefined and the route must make its own client — but only the pinned-version
 * and bundle paths ever touch the database, so it stays lazy to keep the common
 * KV-only path free of a connection. Anything we create here, we close; a db
 * that came from the middleware is left alone for the middleware to close.
 */
function lazyDb(c: { env: Env; var: { db?: WorkerDb }; executionCtx: WaitUntil }): {
  getDb: () => WorkerDb;
  release: () => void;
} {
  let owned: WorkerDb | null = null;
  return {
    getDb: () => {
      if (c.var.db) return c.var.db;
      if (!owned) owned = createWorkerDb(c.env);
      return owned;
    },
    release: () => {
      if (!owned) return;
      let ctx: WaitUntil | undefined;
      try {
        ctx = c.executionCtx;
      } catch {
        // No executionCtx (tests): close without deferring.
      }
      owned = null;
    },
  };
}

const getSkillMdRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/SKILL.md",
  tags: ["Delivery"],
  operationId: "getSkillMd",
  summary: "Fetch a published skill's SKILL.md",
  // Public: no credentials. Overrides the document-level security default.
  security: [],
  request: { params: orgRepoParams },
  responses: {
    200: {
      // Served as raw markdown, not JSON — this is the agent-facing hot path.
      content: { "text/markdown": { schema: z.string() } },
      description: "SKILL.md content",
    },
    ...errorResponses({ isPublic: true }),
  },
});

deliveryRoutes.openapi(getSkillMdRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  if (spec.version) {
    const version = spec.version;
    const { getDb, release } = lazyDb(c);
    try {
      return await serveSkillMdAtVersion(c.env, getDb, org, spec.repo, version, ifNoneMatch);
    } finally {
      release();
    }
  }
  return serveSkillMd(c.env.SKILLS_KV, org, spec.repo, ifNoneMatch);
});

const getSkillMetaRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/meta",
  tags: ["Delivery"],
  operationId: "getSkillMeta",
  summary: "Fetch a published skill's discovery metadata",
  // Public: no credentials. Overrides the document-level security default.
  security: [],
  request: { params: orgRepoParams },
  responses: {
    200: {
      content: { "application/json": { schema: skillMetaResponseSchema } },
      description: "Discovery metadata",
    },
    ...errorResponses({ isPublic: true }),
  },
});

deliveryRoutes.openapi(getSkillMetaRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  if (spec.version) {
    const version = spec.version;
    const { getDb, release } = lazyDb(c);
    try {
      return await serveSkillMetaAtVersion(c.env, getDb, org, spec.repo, version, ifNoneMatch);
    } finally {
      release();
    }
  }
  return serveSkillMeta(c.env.SKILLS_KV, org, spec.repo, ifNoneMatch);
});

const getBundleRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/bundle",
  tags: ["Delivery"],
  operationId: "getSkillBundle",
  summary: "Download a published skill's full bundle",
  // Public: no credentials. Overrides the document-level security default.
  security: [],
  request: { params: orgRepoParams },
  responses: {
    200: {
      content: {
        "application/json": {
          // Every bundle path mapped to its text content, plus the semver served.
          schema: z.object({
            files: z.record(z.string(), z.string()),
            version: z.string(),
          }),
        },
      },
      description: "Skill bundle",
    },
    ...errorResponses({ isPublic: true }),
  },
});

deliveryRoutes.openapi(getBundleRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;

  const { getDb, release } = lazyDb(c);
  try {
    return await serveSkillBundle(c.env, getDb, org, spec.repo, ifNoneMatch, spec.version);
  } finally {
    release();
  }
});
