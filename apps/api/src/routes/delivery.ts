import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { closeWorkerDb, createWorkerDb } from "../lib/db";
import {
  parseRepoSpecifier,
  serveSkillBundle,
  serveSkillMd,
  serveSkillMdAtVersion,
  serveSkillMeta,
  serveSkillMetaAtVersion,
} from "../lib/delivery";

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

function badSpecifier(): Response {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "public, max-age=30" } },
  );
}

/**
 * Lazy DB accessor for the delivery routes.
 *
 * These are public and NOT behind authMiddleware, so `c.var.db` is normally
 * undefined and the route must make its own client — but only the pinned-version
 * and bundle paths ever touch Postgres, so it stays lazy to keep the common
 * KV-only path free of a connection. Anything we create here, we close; a db
 * that came from the middleware is left alone for the middleware to close.
 */
type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

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
      closeWorkerDb(owned, ctx);
      owned = null;
    },
  };
}

const getSkillMdRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/SKILL.md",
  tags: ["Delivery"],
  request: { params: orgRepoParams },
  responses: { 200: { description: "SKILL.md content" } },
});

deliveryRoutes.openapi(getSkillMdRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  if (spec.version) {
    const { getDb, release } = lazyDb(c);
    try {
      return await serveSkillMdAtVersion(c.env, getDb, org, spec.repo, spec.version, ifNoneMatch);
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
  request: { params: orgRepoParams },
  responses: { 200: { description: "Discovery metadata" } },
});

deliveryRoutes.openapi(getSkillMetaRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const ifNoneMatch = c.req.header("If-None-Match") ?? null;
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  if (spec.version) {
    const { getDb, release } = lazyDb(c);
    try {
      return await serveSkillMetaAtVersion(c.env, getDb, org, spec.repo, spec.version, ifNoneMatch);
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
  request: { params: orgRepoParams },
  responses: { 200: { description: "Skill bundle" } },
});

deliveryRoutes.openapi(getBundleRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const spec = parseRepoSpecifier(repo);
  if (!spec) return badSpecifier();
  const { getDb, release } = lazyDb(c);
  try {
    return await serveSkillBundle(
      c.env,
      getDb,
      org,
      spec.repo,
      c.req.header("If-None-Match") ?? null,
      spec.version,
    );
  } finally {
    release();
  }
});
