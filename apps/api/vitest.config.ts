import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
    }),
  ],
  // These tests execute inside workerd, where `process.env` is not the Node
  // process environment — so `process.env.CI` read as undefined on CI and the
  // latency budgets in publish-latency.test.ts silently used their strict local
  // values on shared runners. Inlining the flag at transform time is what makes
  // the relaxed CI budget actually apply.
  define: {
    "process.env.CI": JSON.stringify(process.env.CI ?? ""),
  },
});
