import { describe, expect, it } from "vitest";
import { normalizeFailureText } from "./failure-mining";

describe("normalizeFailureText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeFailureText("  Error:   thing   broke\n\n badly ")).toBe(
      "Error: thing broke badly",
    );
  });

  it("strips volatile tokens so identical failures share a signature", () => {
    const a = normalizeFailureText(
      "Run 550e8400-e29b-41d4-a716-446655440000 failed at /home/user/app/skill.ts:1234 with hash deadbeefcafebabe",
    );
    const b = normalizeFailureText(
      "Run 7c9e6679-7425-40de-944b-e07fc1f90ae7 failed at /var/lib/other/skill.ts:5678 with hash 0011223344556677",
    );
    expect(a).toBe(b);
    expect(a).toContain("<uuid>");
    expect(a).toContain("<path>");
    expect(a).toContain("<hex>");
    expect(a).toContain("<n>");
  });

  it("bounds length to 500 chars", () => {
    expect(normalizeFailureText("x".repeat(2000)).length).toBe(500);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeFailureText("   \n\t ")).toBe("");
  });
});
