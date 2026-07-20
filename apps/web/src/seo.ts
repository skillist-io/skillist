/**
 * Server-side SEO/GEO output for the marketing Worker.
 *
 * apps/web is a client-rendered SPA, so every route previously returned the
 * same static index.html: one title, one description, and a hardcoded canonical
 * pointing at "/". Crawlers that do not execute JS — which includes most AI
 * crawlers — saw an empty <div id="root">. These helpers produce the per-route
 * head, structured data, and the crawler-facing text surfaces, so the Worker can
 * inject them without adopting an SSR framework.
 *
 * Pure functions, no Worker globals, so they are unit-testable.
 */

export const SITE_ORIGIN = "https://skillist.io";

/** Shape of the public `/{org}/{repo}/meta` payload we rely on. */
export type SkillMeta = {
  name: string;
  description: string;
  version: string;
  org: string;
  repo: string;
  publishedAt?: string;
  license?: string;
  sourceType?: "native" | "mirror";
  upstreamRepo?: string;
  installCount?: number;
  activationCount?: number;
  stars?: number;
  category?: string;
  tags?: string[];
};

/**
 * Escapes text for use in HTML text nodes and double-quoted attributes.
 * Skill names/descriptions are user-supplied, so every interpolation below goes
 * through this — an unescaped `"` would otherwise break out of a meta content
 * attribute.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapes a string for embedding inside a <script type="application/ld+json">
 * block. JSON.stringify handles quoting, but `</script>` inside a value would
 * still terminate the element early, so the sequence is neutralised.
 */
export function jsonLdSafe(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Canonical URL for a skill page. */
export function skillUrl(org: string, repo: string): string {
  return `${SITE_ORIGIN}/${org}/${repo}`;
}

/**
 * Per-skill <head> content: title, description, canonical, OG/Twitter, and a
 * pointer to the raw markdown. The markdown alternate matters for GEO — that
 * URL already serves clean SKILL.md from KV and nothing advertised it.
 */
export function skillHeadTags(meta: SkillMeta): string {
  const title = `${meta.name} — Agent Skill · Skillist`;
  const description = truncate(
    meta.description || `${meta.name} is an Agent Skill published by ${meta.org} on Skillist.`,
    160,
  );
  const url = skillUrl(meta.org, meta.repo);

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(`${url}/SKILL.md`)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Skillist" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].join("\n    ");
}

/**
 * SoftwareApplication + BreadcrumbList for a skill page.
 *
 * SoftwareApplication is the type search engines and AI crawlers actually
 * understand for an installable artifact; every field maps to something the
 * meta endpoint already returns, so nothing here is invented.
 */
export function skillJsonLd(meta: SkillMeta): string {
  const url = skillUrl(meta.org, meta.repo);

  const interaction: Record<string, unknown>[] = [];
  const counter = (type: string, count?: number) => {
    if (typeof count === "number" && count > 0) {
      interaction.push({
        "@type": "InteractionCounter",
        interactionType: `https://schema.org/${type}`,
        userInteractionCount: count,
      });
    }
  };
  counter("InstallAction", meta.installCount);
  counter("UseAction", meta.activationCount);
  counter("LikeAction", meta.stars);

  const application: Record<string, unknown> = {
    "@type": "SoftwareApplication",
    "@id": `${url}#skill`,
    name: meta.name,
    description: meta.description,
    url,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Agent Skill",
    operatingSystem: "Any",
    softwareVersion: meta.version,
    downloadUrl: `${url}/bundle`,
    installUrl: url,
    author: { "@type": "Organization", name: meta.org, url: `${SITE_ORIGIN}/${meta.org}` },
    provider: { "@id": `${SITE_ORIGIN}/#org` },
    isAccessibleForFree: true,
    // Agent Skills are markdown bundles, not compiled programs.
    programmingLanguage: "Markdown",
  };
  if (meta.publishedAt) application.dateModified = meta.publishedAt;
  if (meta.license) application.license = meta.license;
  if (meta.upstreamRepo) application.codeRepository = meta.upstreamRepo;
  if (meta.category) application.applicationSuite = meta.category;
  if (meta.tags?.length) application.keywords = meta.tags.join(", ");
  if (interaction.length) application.interactionStatistic = interaction;

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Registry", item: `${SITE_ORIGIN}/registry` },
      { "@type": "ListItem", position: 2, name: meta.org, item: `${SITE_ORIGIN}/${meta.org}` },
      { "@type": "ListItem", position: 3, name: meta.name, item: url },
    ],
  };

  return `<script type="application/ld+json">${jsonLdSafe({
    "@context": "https://schema.org",
    "@graph": [application, breadcrumb],
  })}</script>`;
}

/**
 * A crawler-visible summary injected into the SPA root.
 *
 * React replaces #root on hydration, so this is never seen by a browser user —
 * it exists so a non-JS crawler gets the skill's identity, a definitional first
 * sentence it can quote, and links it can follow.
 */
export function skillNoscriptBody(meta: SkillMeta): string {
  const url = skillUrl(meta.org, meta.repo);
  const lead = `${meta.name} is an Agent Skill published by ${meta.org} on Skillist, currently at version ${meta.version}.`;
  return [
    `<article>`,
    `<h1>${escapeHtml(meta.name)}</h1>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<p>${escapeHtml(truncate(meta.description ?? "", 600))}</p>`,
    `<ul>`,
    `<li><a href="${escapeHtml(`${url}/SKILL.md`)}">SKILL.md (markdown)</a></li>`,
    `<li><a href="${escapeHtml(`${url}/bundle`)}">Download bundle</a></li>`,
    `<li><a href="${SITE_ORIGIN}/registry">Browse the Skillist registry</a></li>`,
    `</ul>`,
    `</article>`,
  ].join("");
}

/** Site-wide Organization + WebSite/SearchAction, for the landing page. */
export function siteJsonLd(): string {
  return `<script type="application/ld+json">${jsonLdSafe({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#org`,
        name: "Skillist",
        url: SITE_ORIGIN,
        description:
          "Realtime registry and control plane for Agent Skills, compliant with the agentskills.io spec.",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#site`,
        url: SITE_ORIGIN,
        name: "Skillist",
        publisher: { "@id": `${SITE_ORIGIN}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_ORIGIN}/registry?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  })}</script>`;
}

/**
 * robots.txt. AI crawlers are explicitly allowed: discovery-by-agent is the
 * product, and naming them guards against a future blanket default.
 */
export function robotsTxt(): string {
  const aiAgents = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "PerplexityBot",
    "Google-Extended",
  ];
  return [
    "User-agent: *",
    "Allow: /",
    "",
    ...aiAgents.flatMap((agent) => [`User-agent: ${agent}`, "Allow: /", ""]),
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export type RegistryEntry = {
  orgSlug: string;
  skillRepo: string;
  name?: string;
  description?: string;
  latestVersion?: string | null;
  updatedAt?: string | null;
};

/** XML sitemap over the public registry. */
export function sitemapXml(entries: RegistryEntry[]): string {
  const urls = [
    `<url><loc>${SITE_ORIGIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE_ORIGIN}/registry</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>`,
    ...entries.map((e) => {
      const loc = escapeHtml(skillUrl(e.orgSlug, e.skillRepo));
      const lastmod = e.updatedAt ? `<lastmod>${escapeHtml(e.updatedAt)}</lastmod>` : "";
      return `<url><loc>${loc}</loc>${lastmod}<changefreq>daily</changefreq><priority>0.8</priority></url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * /llms.txt — a machine-readable catalogue of the public registry.
 *
 * This is the highest-leverage GEO surface for a registry whose whole premise is
 * agent discovery: one line per skill, each pointing at markdown an LLM can read
 * directly.
 */
export function llmsTxt(entries: RegistryEntry[]): string {
  const lines = [
    "# Skillist",
    "",
    "> Realtime registry for Agent Skills (agentskills.io spec). Every skill below",
    "> serves its SKILL.md as plain markdown at the listed URL.",
    "",
    "## Skills",
    "",
    ...entries.map((e) => {
      const url = skillUrl(e.orgSlug, e.skillRepo);
      const desc = e.description ? `: ${e.description.replace(/\s+/g, " ").trim()}` : "";
      return `- [${e.orgSlug}/${e.skillRepo}](${url}/SKILL.md)${desc}`;
    }),
    "",
    "## Docs",
    "",
    "- [Documentation](https://docs.skillist.io)",
    "- [API reference](https://api.skillist.io/docs)",
    "",
  ];
  return lines.join("\n");
}
