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
      },
      social: [
        {
          icon: "external",
          label: "skillist.io",
          href: "https://skillist.io",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/skillist-dev/skillist",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/skillist-dev/skillist/edit/main/apps/docs/",
      },
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
