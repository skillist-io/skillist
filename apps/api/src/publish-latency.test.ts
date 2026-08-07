import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cachePublishedSkill, getPublishedSkillMd } from "./lib/publish";

const ORG = "bench-org";
const SLUG = "bench-skill";
const SKILL_MD = `---
name: bench-skill
description: Latency benchmark fixture
---

# Bench skill
`;

describe("publish hot-path latency", () => {
  // Read from the worker env, not `process.env`: these tests run inside
  // workerd, where `process.env` is not the Node process environment and
  // `process.env.CI` is always undefined. Reading it there meant the relaxed
  // budgets below never applied on CI — the strict local numbers were silently
  // enforced on shared runners, and passed only by luck.
  const isCi = Boolean((env as Record<string, unknown>).CI);
  const kvLimit = isCi ? 200 : 50;
  const doLimit = isCi ? 500 : 100;

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
        skillRepo: SLUG,
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
