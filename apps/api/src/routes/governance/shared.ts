import { z } from "@hono/zod-openapi";
import type { Env } from "../../env";
import type { AuthContext } from "../../lib/auth-middleware";
import type { WorkerDb } from "../../lib/db";

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

/** One point of a per-day series produced by `lib/time-series.ts`. */
export const dayPointSchema = z.object({ date: z.string(), count: z.number() });

/** A row of `skill_runs`; timestamps serialize to ISO strings. */
export const skillRunRowSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  versionId: z.string().uuid(),
  orgSlug: z.string(),
  skillRepo: z.string(),
  scriptPath: z.string(),
  runtime: z.string(),
  status: z.string(),
  args: z.array(z.string()).nullable(),
  targetUrl: z.string().nullable(),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  actorId: z.string().nullable(),
  actorType: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
