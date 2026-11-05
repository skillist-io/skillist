import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { isProductionEnv } from "./db";

const envFor = (url?: string) => ({ BETTER_AUTH_URL: url }) as unknown as Env;

/**
 * This guard gates alerting, the Hyperdrive cache-binding check, and whether
 * localhost CORS origins are allowed. Its hostname is a regex, so a domain
 * rename done by plain text search skips it and every one of those flips
 * silently — pin it directly rather than relying on the alert tests to notice.
 */
describe("isProductionEnv", () => {
  it("matches the production hosts", () => {
    expect(isProductionEnv(envFor("https://api.skillist.dev"))).toBe(true);
    expect(isProductionEnv(envFor("https://skillist.dev"))).toBe(true);
    expect(isProductionEnv(envFor("https://api.skillist.dev/"))).toBe(true);
  });

  it("does not match local or unset config", () => {
    expect(isProductionEnv(envFor("http://localhost:8787"))).toBe(false);
    expect(isProductionEnv(envFor(undefined))).toBe(false);
  });

  it("does not match the legacy domain or look-alike hosts", () => {
    expect(isProductionEnv(envFor("https://api.skillist.io"))).toBe(false);
    expect(isProductionEnv(envFor("https://notskillist.dev"))).toBe(false);
    expect(isProductionEnv(envFor("https://skillist.dev.example.com"))).toBe(false);
  });
});
