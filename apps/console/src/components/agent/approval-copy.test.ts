import { describe, expect, it } from "vitest";
import { canDecideApprovals, currentOrgFact, describeApproval, outcomeLine } from "./approval-copy";

describe("canDecideApprovals", () => {
  it("matches the route's editor minimum", () => {
    expect(canDecideApprovals("owner")).toBe(true);
    expect(canDecideApprovals("editor")).toBe(true);
    expect(canDecideApprovals("publisher")).toBe(false);
    expect(canDecideApprovals("viewer")).toBe(false);
  });

  it("keeps the buttons while the role is still loading", () => {
    expect(canDecideApprovals(undefined)).toBe(true);
  });
});

describe("describeApproval", () => {
  it("names what happens on the button, because approving also runs it", () => {
    expect(describeApproval("remember", { key: "k", value: "v" }).approveLabel).toBe(
      "Approve and save",
    );
    expect(describeApproval("forget", { key: "k" }).approveLabel).toBe("Approve and forget");
    expect(describeApproval("anything_else", null).approveLabel).toBe("Approve and run");
  });

  it("keeps the title and its parts in step", () => {
    const copy = describeApproval("remember", { key: "policy:x", value: "v" });
    expect(`${copy.action} ${copy.subject}`).toBe(copy.title);
  });
});

describe("what a decision is made on", () => {
  const memories = [
    { key: "k", value: "personal", userId: "u1" },
    { key: "k", value: "org value", userId: null },
  ];

  it("shows the value being forgotten, from the org's facts only", () => {
    const current = currentOrgFact(memories, { key: "k" });
    expect(describeApproval("forget", { key: "k" }, current).detail).toBe("org value");
  });

  it("warns about an overwrite, but not when nothing would change", () => {
    const args = { key: "k", value: "new" };
    expect(describeApproval("remember", args, "old").replaces).toBe("old");
    expect(describeApproval("remember", args, "new").replaces).toBeUndefined();
  });
});

describe("outcomeLine", () => {
  it("says why a refused action didn't run", () => {
    expect(outcomeLine("refused", "skill_not_found")).toBe(
      "Approved, but it couldn't run: skill not found. Nothing changed.",
    );
  });
});
