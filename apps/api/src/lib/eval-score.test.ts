import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { DEFAULT_SCENARIOS, generateScenariosFromSkill, parseScore } from "./eval";
import { ModelRateLimitError } from "./model";

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

describe("generateScenariosFromSkill", () => {
  const envWith = (run: unknown) => ({ AI: { run } }) as unknown as Env;

  it("does not swap in generic scenarios when rate limited", async () => {
    const run = vi.fn().mockRejectedValue(new Error("3021: rate limiting"));
    await expect(generateScenariosFromSkill(envWith(run), "skill", 3)).rejects.toBeInstanceOf(
      ModelRateLimitError,
    );
  });

  it("still falls back when the model returns something unusable", async () => {
    const run = vi.fn().mockResolvedValue({ response: "no json here" });
    await expect(generateScenariosFromSkill(envWith(run), "skill", 3)).resolves.toEqual(
      DEFAULT_SCENARIOS,
    );
  });
});
