import { describe, expect, it } from "vitest";
import { canDecideApprovals, describeApproval } from "./approval-copy";

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
