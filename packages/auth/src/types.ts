import type * as schema from "@skillist/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type WorkerDb = DrizzleD1Database<typeof schema>;
