import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@skillist/db/schema";

export type WorkerDb = PostgresJsDatabase<typeof schema>;
