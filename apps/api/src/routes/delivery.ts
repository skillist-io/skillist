import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { createWorkerDb } from "../lib/db";
import { serveSkillBundle, serveSkillMd, serveSkillMeta } from "../lib/delivery";

type AppEnv = {
  Bindings: Env;
  Variables: { auth?: AuthContext; db?: WorkerDb };
};

export const deliveryRoutes = new OpenAPIHono<AppEnv>();

const orgRepoParams = z.object({
  org: z.string().min(1),
  repo: z.string().min(1),
});

const getSkillMdRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/SKILL.md",
  tags: ["Delivery"],
  request: { params: orgRepoParams },
  responses: { 200: { description: "SKILL.md content" } },
});

deliveryRoutes.openapi(getSkillMdRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  return serveSkillMd(c.env.SKILLS_KV, org, repo);
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
  return serveSkillMeta(c.env.SKILLS_KV, org, repo);
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
  const db = c.var.db ?? createWorkerDb(c.env);
  return serveSkillBundle(c.env, db, org, repo);
});
