import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Enforces the operation metadata an OpenAPI consumer actually needs.
 *
 * These are not cosmetic. Without operationId every code generator emits
 * auto-derived garbage method names, so no typed SDK is possible; without
 * declared error responses a client cannot know which failures to handle. Both
 * were absent on all 96 operations.
 */

type Operation = {
  operationId?: string;
  summary?: string;
  responses?: Record<string, unknown>;
  security?: unknown[];
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

async function operations(): Promise<{ key: string; path: string; op: Operation }[]> {
  const res = await SELF.fetch("http://localhost/openapi.json");
  const doc = (await res.json()) as { paths: Record<string, Record<string, Operation>> };
  const out: { key: string; path: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op) out.push({ key: `${method.toUpperCase()} ${path}`, path, op });
    }
  }
  return out;
}

describe("operation metadata", () => {
  it("gives every operation an operationId", async () => {
    const missing = (await operations()).filter((o) => !o.op.operationId).map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it("keeps operationIds unique", async () => {
    // Duplicates silently collide in generated clients.
    const ids = (await operations()).map((o) => o.op.operationId).filter(Boolean) as string[];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("uses camelCase operationIds", async () => {
    const bad = (await operations())
      .filter((o) => o.op.operationId && !/^[a-z][A-Za-z0-9]*$/.test(o.op.operationId))
      .map((o) => `${o.key} -> ${o.op.operationId}`);
    expect(bad).toEqual([]);
  });

  it("gives every operation a summary", async () => {
    const missing = (await operations()).filter((o) => !o.op.summary).map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it("declares 429 on rate-limited surfaces", async () => {
    // rateLimit() wraps all of /v1/* and the apex execution paths, so a client
    // can receive 429 from any of them.
    const missing = (await operations())
      .filter((o) => o.path.startsWith("/v1/"))
      .filter((o) => !o.op.responses?.["429"])
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it("declares 401 wherever auth is required", async () => {
    const missing = (await operations())
      .filter((o) => o.path.startsWith("/v1/"))
      // security: [] marks the public browse endpoints, which cannot 401.
      .filter((o) => !Array.isArray(o.op.security) || o.op.security.length > 0)
      .filter((o) => !o.op.responses?.["401"])
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it("declares 500 so the correlationId envelope is documented", async () => {
    const missing = (await operations())
      .filter((o) => o.path.startsWith("/v1/"))
      .filter((o) => !o.op.responses?.["500"])
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });
});
