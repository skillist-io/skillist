import { describe, expect, it } from "vitest";
import { parseOptionalNumber } from "./optional-number";

describe("parseOptionalNumber", () => {
  it("treats blank as not set", () => {
    expect(parseOptionalNumber("")).toBeUndefined();
    expect(parseOptionalNumber("  ")).toBeUndefined();
  });

  it("keeps 0 as a real value", () => {
    expect(parseOptionalNumber("0")).toBe(0);
  });

  it("reads negative values", () => {
    expect(parseOptionalNumber("-5")).toBe(-5);
  });
});
