import { describe, expect, it } from "vitest";
import { toolLabel } from "./tool-label";

describe("toolLabel", () => {
  it("uses present tense while running and past tense when done", () => {
    expect(toolLabel("get_coverage", undefined, false)).toBe("Checking coverage…");
    expect(toolLabel("get_coverage", undefined, true)).toBe("Checked required-skill coverage");
  });

  it("labels each known agent tool", () => {
    expect(toolLabel("list_recurring_failures", undefined, true)).toBe("Listed recurring failures");
    expect(toolLabel("list_required_skills", undefined, true)).toBe("Listed required skills");
    expect(toolLabel("recommend_required_skills", undefined, true)).toBe(
      "Recommended required skills",
    );
    expect(toolLabel("flag_stale_evals", undefined, true)).toBe("Flagged stale evals");
  });

  it("includes org/repo target for draft_improvement", () => {
    expect(toolLabel("draft_improvement", { ref: "acme/deploy" }, true)).toBe(
      "Drafted improvement for acme/deploy",
    );
    expect(toolLabel("draft_improvement", { org: "acme", skill: "deploy" }, false)).toBe(
      "Drafting improvement for acme/deploy…",
    );
    expect(toolLabel("draft_improvement", {}, true)).toBe("Drafted improvement");
  });

  it("humanizes unknown tools", () => {
    expect(toolLabel("some_new_tool", undefined, true)).toBe("some new tool");
    expect(toolLabel("some_new_tool", undefined, false)).toBe("some new tool…");
  });
});
