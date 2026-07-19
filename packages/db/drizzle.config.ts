import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs with its cwd at packages/db, so load the monorepo-root .env.
// dotenv does not override variables already set in the environment, so CI and
// production (which set DATABASE_URL directly) are unaffected.
config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
