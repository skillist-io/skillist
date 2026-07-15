import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  cachePublishedSkill,
  getPublishedSkillMd,
} from "./lib/publish";

const ORG = "bench-org";
const SLUG = "bench-skill";
const SKILL_MD = `---
name: bench-skill
description: Latency benchmark fixture
---

# Bench skill
`;

describe("publish hot-path latency", () => {
  const kvLimit = process.env.CI ? 200 : 50;
  const doLimit = process.env.CI ? 500 : 100;

  it("reads published SKILL.md from KV within budget", async () => {
    await cachePublishedSkill(env.SKILLS_KV, ORG, SLUG, {
      skillMd: SKILL_MD,
      meta: {
        name: SLUG,
        description: "Latency benchmark fixture",
        version: "1.0.0",
        versionId: "00000000-0000-0000-0000-000000000001",
        etag: "bench",
        org: ORG,
        slug: SLUG,
        publishedAt: new Date().toISOString(),
      },
    });

    const start = performance.now();
    const result = await getPublishedSkillMd(env.SKILLS_KV, ORG, SLUG);
    const elapsed = performance.now() - start;

    expect(result?.skillMd).toContain("bench-skill");
    expect(elapsed).toBeLessThan(kvLimit);
  });

  it("broadcasts via Durable Object within budget", async () => {
    const id = env.SKILL_HUB.idFromName(`${ORG}:${SLUG}`);
    const stub = env.SKILL_HUB.get(id);

    const start = performance.now();
    const res = await stub.fetch("http://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "skill.published",
        orgSlug: ORG,
        skillSlug: SLUG,
        version: "1.0.0",
        skillMd: SKILL_MD,
        publishedAt: Date.now(),
      }),
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(doLimit);
  });
});
