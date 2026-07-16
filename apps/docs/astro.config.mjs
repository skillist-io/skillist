// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.skillist.dev",
  output: "static",
  integrations: [
    starlight({
      title: "Skillist",
      tagline: "Agent skills platform documentation",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "Skillist",
        replacesTitle: false,
      },
      customCss: ["./src/styles/skillist.css"],
      components: {
        Head: "./src/components/Head.astro",
      },
      social: [
        {
          icon: "external",
          label: "skillist.dev",
          href: "https://skillist.dev",
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
            { label: "Registry", slug: "platform/registry" },
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
});
