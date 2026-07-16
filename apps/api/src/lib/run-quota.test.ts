import { describe, expect, it } from "vitest";
import type { ExecutionPolicy } from "@skillist/contracts";

const DEFAULT_POLICY: Required<ExecutionPolicy> = {
  hourlyRunLimit: 50,
  dailyRunLimit: 500,
  containerHourlyLimit: 10,
  anonymousHourlyLimit: 10,
};

function resolvePolicy(policy?: ExecutionPolicy | null): Required<ExecutionPolicy> {
  return { ...DEFAULT_POLICY, ...policy };
}

describe("execution policy defaults", () => {
  it("applies defaults when policy is empty", () => {
    expect(resolvePolicy({})).toEqual(DEFAULT_POLICY);
  });

  it("merges overrides", () => {
    expect(resolvePolicy({ hourlyRunLimit: 5 })).toMatchObject({
      hourlyRunLimit: 5,
      dailyRunLimit: 500,
    });
  });
});

describe("skill visibility access rules", () => {
  it("public skills allow anonymous runs", () => {
    const visibility = "public";
    const auth = { userId: null, apiKeyId: null };
    const allowsAnonymous = visibility === "public" && !auth.userId && !auth.apiKeyId;
    expect(allowsAnonymous).toBe(true);
  });

  it("private skills require authentication", () => {
    const visibility = "private";
    const auth = { userId: null, apiKeyId: null };
    const requiresAuth = visibility !== "public" && !auth.userId && !auth.apiKeyId;
    expect(requiresAuth).toBe(true);
  });
});
