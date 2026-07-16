import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
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
