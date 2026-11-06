import { describe, expect, it } from "vitest";
import { canDecideApprovals } from "./approval-copy";

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
