import type { Env } from "../../env";
import type { AuthContext } from "../../lib/auth-middleware";
import type { WorkerDb } from "../../lib/db";

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};
