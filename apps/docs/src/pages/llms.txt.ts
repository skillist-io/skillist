import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

/**
 * /llms.txt — a curated index of the documentation for LLM consumption.
 *
 * Generated from the docs content collection rather than hand-maintained, so it
 * cannot drift as pages are added or renamed (the Starlight sidebar is
 * hand-maintained; this deliberately is not).
 *
 * Grouped by top-level section so a model can see the shape of the docs before
 * fetching anything.
 */
export const GET: APIRoute = async () => {
  const entries = await getCollection("docs");

  const bySection = new Map<string, { title: string; url: string; description?: string }[]>();
  for (const entry of entries) {
    // id looks like "getting-started/quick-start"; the index page has no slash.
    const [section = "overview"] = entry.id.split("/");
    const url = `https://docs.skillist.io/${entry.id.replace(/(^|\/)index$/, "")}`;
    const list = bySection.get(section) ?? [];
    list.push({
      title: entry.data.title,
      url,
      description: entry.data.description,
    });
    bySection.set(section, list);
  }

  const lines = [
    "# Skillist Documentation",
    "",
    "> Skillist is a realtime registry and control plane for Agent Skills,",
    "> compliant with the agentskills.io spec. It stores, versions, evaluates,",
    "> and delivers SKILL.md bundles, and closes the loop with AI-drafted",
    "> improvements from approved feedback.",
    "",
  ];

  for (const [section, pages] of [...bySection].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${section}`, "");
    for (const page of pages.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(
        `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Related",
    "",
    "- [Registry catalogue (every public skill, as markdown)](https://skillist.io/llms.txt)",
    "- [API reference](https://api.skillist.io/docs)",
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
