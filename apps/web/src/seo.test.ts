import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  llmsTxt,
  robotsTxt,
  type SkillMeta,
  sitemapXml,
  skillHeadTags,
  skillJsonLd,
  skillNoscriptBody,
} from "./seo";

const meta: SkillMeta = {
  name: "Web Perf Audit",
  description: "Audits Core Web Vitals and reports render-blocking resources.",
  version: "1.2.3",
  org: "skillist",
  repo: "web-perf-audit",
  publishedAt: "2026-07-01T00:00:00.000Z",
  license: "MIT",
  installCount: 42,
  stars: 7,
};

describe("escaping", () => {
  it("escapes characters that would break out of an attribute or element", () => {
    expect(escapeHtml(`" onload="alert(1)`)).not.toContain('"');
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
});

describe("skillHeadTags", () => {
  it("emits a canonical pointing at the skill, not the homepage", () => {
    // The bug this whole change exists to fix: every page previously canonicalised
    // to "/", telling crawlers the entire registry was duplicate content.
    expect(skillHeadTags(meta)).toContain(
      '<link rel="canonical" href="https://skillist.io/skillist/web-perf-audit" />',
    );
  });

  it("advertises the raw markdown alternate for AI crawlers", () => {
    expect(skillHeadTags(meta)).toContain(
      'rel="alternate" type="text/markdown" href="https://skillist.io/skillist/web-perf-audit/SKILL.md"',
    );
  });

  it("escapes a hostile skill name rather than emitting raw markup", () => {
    const hostile = { ...meta, name: '"><script>alert(1)</script>' };
    const html = skillHeadTags(hostile);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("pairs summary_large_image with an actual image", () => {
    // Declaring the large card without an image renders a blank box, so these
    // two must never drift apart.
    const html = skillHeadTags(meta);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:image" content="https://skillist.io/og-default.png"');
    expect(html).toContain('name="twitter:image"');
  });

  it("falls back to a generated description when the skill has none", () => {
    const bare = { ...meta, description: "" };
    expect(skillHeadTags(bare)).toContain("is an Agent Skill published by skillist");
  });
});

describe("skillJsonLd", () => {
  it("describes the skill as a SoftwareApplication with its version", () => {
    const parsed = JSON.parse(
      skillJsonLd(meta)
        .replace(/^<script type="application\/ld\+json">/, "")
        .replace(/<\/script>$/, ""),
    );
    const app = parsed["@graph"][0];
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.softwareVersion).toBe("1.2.3");
    expect(app.downloadUrl).toBe("https://skillist.io/skillist/web-perf-audit/bundle");
  });

  it("omits interaction counters that have no data instead of emitting zeros", () => {
    const noCounts: SkillMeta = { ...meta, installCount: undefined, stars: undefined };
    const json = skillJsonLd(noCounts);
    expect(json).not.toContain("InteractionCounter");
  });

  it("neutralises a closing script tag inside a description", () => {
    // Otherwise the ld+json block terminates early and the rest of the payload
    // is parsed as HTML.
    const hostile = { ...meta, description: "</script><img onerror=alert(1)>" };
    expect(skillJsonLd(hostile)).not.toContain("</script><img");
  });
});

describe("skillNoscriptBody", () => {
  it("leads with a self-contained definitional sentence", () => {
    const body = skillNoscriptBody(meta);
    expect(body).toContain("Web Perf Audit is an Agent Skill published by skillist");
    expect(body).toContain("<h1>Web Perf Audit</h1>");
  });
});

describe("robotsTxt", () => {
  it("explicitly allows AI crawlers and points at the sitemap", () => {
    const txt = robotsTxt();
    for (const agent of ["GPTBot", "ClaudeBot", "PerplexityBot"]) {
      expect(txt).toContain(`User-agent: ${agent}`);
    }
    expect(txt).toContain("Sitemap: https://skillist.io/sitemap.xml");
  });
});

describe("sitemapXml", () => {
  it("includes each skill with lastmod when known", () => {
    const xml = sitemapXml([
      { orgSlug: "acme", skillRepo: "widget", updatedAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(xml).toContain("<loc>https://skillist.io/acme/widget</loc>");
    expect(xml).toContain("<lastmod>2026-07-01T00:00:00.000Z</lastmod>");
  });

  it("omits lastmod rather than emitting an empty element", () => {
    const xml = sitemapXml([{ orgSlug: "acme", skillRepo: "widget" }]);
    expect(xml).not.toContain("<lastmod>");
  });

  it("still emits valid XML for an empty registry", () => {
    expect(sitemapXml([])).toContain("<urlset");
  });
});

describe("llmsTxt", () => {
  it("links each skill to its markdown, not its HTML page", () => {
    const txt = llmsTxt([{ orgSlug: "acme", skillRepo: "widget", description: "Does a thing." }]);
    expect(txt).toContain("[acme/widget](https://skillist.io/acme/widget/SKILL.md)");
    expect(txt).toContain("Does a thing.");
  });
});
