import { describe, expect, it } from "vitest";
import { parseScore } from "./eval";

describe("parseScore", () => {
  it("reads a number from the judge's reply", () => {
    expect(parseScore("73")).toBe(73);
    expect(parseScore("Score: 85/100")).toBe(85);
  });

  it("caps at 100", () => {
    expect(parseScore("250")).toBe(100);
  });

  it("refuses to invent a score", () => {
    expect(() => parseScore("I can't rate this")).toThrow("The judge did not return a score");
  });
});
