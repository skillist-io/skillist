// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: "https://docs.skillist.io",
  output: "static",
  integrations: [
    react(),
    starlight({
      title: "Skillist",
      tagline: "Agent skills platform documentation",
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        alt: "Skillist",
        replacesTitle: true,
      },
      customCss: ["./src/styles/globals.css", "./src/styles/starlight.css"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        Hero: "./src/components/Hero.astro",
        Header: "./src/components/Header.astro",
        // Head.astro existed but was never registered here, so it rendered
        // nowhere. Registering it is what makes the GTM injection inside it
        // actually reach the page.
        Head: "./src/components/Head.astro",
      },
      social: [
        {
          icon: "external",
          label: "skillist.io",
          href: "https://skillist.io",
        },
        // GitHub social link and editLink removed: they pointed at
        // skillist-dev/skillist, which does not exist (404), and the source
        // repo is private so "Edit page" cannot resolve for any reader.
        // Restore both once there is a public repo.
      ],
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Introduction", slug: "index" },
            { label: "Quick start", slug: "getting-started/quick-start" },
            { label: "CLI", slug: "getting-started/cli" },
          ],
        },
        {
          label: "Registry MCP",
          items: [
            { label: "Overview", slug: "mcp" },
            { label: "Connect your agent", slug: "mcp/connect" },
            { label: "OAuth authentication", slug: "mcp/oauth" },
            { label: "Tools reference", slug: "mcp/tools" },
          ],
        },
        {
          label: "Platform",
          items: [
            { label: "Delivery URLs", slug: "platform/delivery" },
            { label: "Registry", slug: "platform/registry" },
            { label: "Projects", slug: "platform/projects" },
            { label: "Official mirrors", slug: "platform/official-mirrors" },
            { label: "Skill inventory", slug: "platform/inventory" },
            { label: "Install policy", slug: "platform/install-policy" },
            { label: "Required-skill coverage", slug: "platform/coverage" },
            { label: "Self-improving skills", slug: "platform/self-improving" },
            { label: "Platform agent", slug: "platform/agent" },
            { label: "Authentication", slug: "platform/authentication" },
            { label: "Sandbox execution", slug: "platform/sandbox" },
          ],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: "#171717",
          },
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
});
