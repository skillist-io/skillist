import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Every success response must declare a body schema.
 *
 * Without one the reference shows no example payload, and — more importantly —
 * a generated client types the response as `unknown`, which makes an SDK
 * useless. 64 of 96 operations were in that state.
 */

type Operation = { responses?: Record<string, { content?: unknown }> };
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

async function spec() {
  const res = await SELF.fetch("http://localhost/openapi.json");
  return (await res.json()) as { paths: Record<string, Record<string, Operation>> };
}

describe("response schemas", () => {
  it("declares a body schema for every 2xx response", async () => {
    const doc = await spec();
    const missing: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        for (const [code, response] of Object.entries(op.responses ?? {})) {
          // 204 carries no body by definition; 101 is the WebSocket upgrade.
          if (!code.startsWith("2") || code === "204") continue;
          if (!response.content) missing.push(`${method.toUpperCase()} ${path} -> ${code}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
