import type * as schema from "@skillist/db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type WorkerDb = PostgresJsDatabase<typeof schema>;
