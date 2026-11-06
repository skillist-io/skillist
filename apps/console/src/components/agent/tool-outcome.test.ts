import { getToolPartState } from "@cloudflare/ai-chat/react";
import { describe, expect, it } from "vitest";
import { toolOutcome } from "./tool-outcome";

describe("toolOutcome", () => {
  it("does not treat a gated call as done, though the SDK calls it complete", () => {
    const output = { ok: false, status: "awaiting_approval", approvalId: "a1" };
    const part = {
      type: "tool-draft_improvement",
      toolCallId: "t",
      state: "output-available",
      input: {},
      output,
    };
    // Pins the SDK behaviour this module exists to correct.
    const state = getToolPartState(part as never);
    expect(state).toBe("complete");
    expect(toolOutcome(state, output)).toEqual({ kind: "awaiting", approvalId: "a1" });
  });

  it("reports a denied gate", () => {
    expect(toolOutcome("complete", { ok: false, status: "denied" })).toEqual({ kind: "denied" });
  });

  it("names a refusal in plain language", () => {
    expect(toolOutcome("complete", { ok: false, reason: "skill_not_found" })).toEqual({
      kind: "refused",
      reason: "skill not found",
    });
    expect(toolOutcome("complete", { ok: false, reason: "new_reason" })).toEqual({
      kind: "refused",
      reason: "new reason",
    });
    expect(toolOutcome("complete", { ok: false })).toEqual({
      kind: "refused",
      reason: "the tool declined",
    });
  });

  it("carries the error text of a failed call", () => {
    expect(toolOutcome("error", undefined, "boom")).toEqual({ kind: "failed", reason: "boom" });
  });

  it("treats anything without ok:false as done", () => {
    expect(toolOutcome("complete", { ok: true })).toEqual({ kind: "done" });
    expect(toolOutcome("complete", [1, 2])).toEqual({ kind: "done" });
    expect(toolOutcome("approved", undefined)).toEqual({ kind: "done" });
  });

  it("is running until the call returns", () => {
    expect(toolOutcome("loading", undefined)).toEqual({ kind: "running" });
    expect(toolOutcome("streaming", undefined)).toEqual({ kind: "running" });
  });
});
