import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendors into their own chunks so an app
        // code change doesn't bust the whole vendor cache. TanStack Router still
        // code-splits per route on top of this.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler"))
            return "react";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("radix-ui") || id.includes("@radix-ui")) return "radix";
          // NB: don't hand-split better-auth/better-call into their own chunk.
          // They are CommonJS; a manual chunk orphans esbuild's __commonJSMin
          // interop helper in another chunk and the app fails to mount
          // ("__commonJSMin is not a function"). Let Rollup co-locate them.
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/v1": "http://localhost:8787",
      "/docs": "http://localhost:8787",
      "/openapi.json": "http://localhost:8787",
      // GitHub-style apex API: /{org}/{repo}/SKILL.md|meta|bundle|scripts|run|runs
      "^/[^/]+/[^/]+/(SKILL\\.md|meta|bundle|scripts|run|runs)(/.*)?$": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "^/runs/": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
