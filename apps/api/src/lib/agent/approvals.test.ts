import { describe, expect, it } from "vitest";
import { callSignature } from "./approvals";

describe("callSignature", () => {
  it("is stable regardless of argument key order", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "fix x" });
    const b = await callSignature("draft_improvement", { note: "fix x", skillRepo: "pdf-tools" });
    expect(a).toBe(b);
  });

  it("is stable regardless of nested key order", async () => {
    const a = await callSignature("t", { outer: { b: 2, a: 1 }, list: [{ y: 1, x: 2 }] });
    const b = await callSignature("t", { list: [{ x: 2, y: 1 }], outer: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it("changes when the tool name changes", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools" });
    const b = await callSignature("other_tool", { skillRepo: "pdf-tools" });
    expect(a).not.toBe(b);
  });

  it("changes when an argument value changes", async () => {
    const a = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "one" });
    const b = await callSignature("draft_improvement", { skillRepo: "pdf-tools", note: "two" });
    expect(a).not.toBe(b);
  });

  it("produces a 64-char hex sha-256 digest", async () => {
    const sig = await callSignature("t", { a: 1 });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
