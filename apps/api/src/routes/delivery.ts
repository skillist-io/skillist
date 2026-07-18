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
    const getDb = () => c.var.db ?? createWorkerDb(c.env);
    return serveSkillMdAtVersion(c.env, getDb, org, spec.repo, spec.version, ifNoneMatch);
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
    const getDb = () => c.var.db ?? createWorkerDb(c.env);
    return serveSkillMetaAtVersion(c.env, getDb, org, spec.repo, spec.version, ifNoneMatch);
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
  const db = c.var.db ?? createWorkerDb(c.env);
  return serveSkillBundle(
    c.env,
    db,
    org,
    spec.repo,
    c.req.header("If-None-Match") ?? null,
    spec.version,
  );
});
