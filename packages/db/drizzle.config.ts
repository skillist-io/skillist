import { defineConfig } from "drizzle-kit";

// Generates SQL only. Wrangler applies it (`wrangler d1 migrations apply`), which
// is why `out` is the directory wrangler.jsonc's `migrations_dir` points at.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
