import * as schema from "@skillist/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../env";

export function createWorkerDb(env: Env): import("@skillist/auth").WorkerDb {
  const client = postgres(env.HYPERDRIVE.connectionString, {
    prepare: false,
    max: 1,
  });
  return drizzle(client, { schema });
}

export type { WorkerDb } from "@skillist/auth";
