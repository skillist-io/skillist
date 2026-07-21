import { describe, expect, it } from "vitest";
import type { SkillBundle } from "./index.js";
import { isAllowedHostPattern, pluginManifestSchema } from "./plugin.js";
import { scanSkillSecurity } from "./security.js";

// Per-skill egress allowlist (plugin.json `network.allowedHosts`): validated at
// publish time and surfaced to the security scan. Broad/catch-all patterns are
// rejected so a skill can't self-grant unrestricted egress.

describe("isAllowedHostPattern", () => {
  it("accepts concrete hosts and specific wildcards", () => {
    for (const host of [
      "api.stripe.com",
      "github.com",
      "*.example.com",
      "*.githubusercontent.com",
      "registry.npmjs.org",
    ]) {
      expect(isAllowedHostPattern(host)).toBe(true);
    }
  });

  it("rejects catch-all and TLD-wide patterns", () => {
    for (const host of ["*", "*.*", "**", "*.com", "*.io", "", "   ", "localhost", "not a host"]) {
      expect(isAllowedHostPattern(host)).toBe(false);
    }
  });
});

describe("pluginManifestSchema network.allowedHosts", () => {
  it("accepts a valid declared allowlist", () => {
    const parsed = pluginManifestSchema.safeParse({
      name: "x",
      network: { allowedHosts: ["api.stripe.com", "*.example.com"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a manifest that declares a catch-all host", () => {
    const parsed = pluginManifestSchema.safeParse({
      name: "x",
      network: { allowedHosts: ["*"] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("security scan network signal", () => {
  it("surfaces declared hosts as a non-blocking low-severity issue", () => {
    const bundle: SkillBundle = new Map([
      ["SKILL.md", "# ok\nnothing suspicious here"],
      ["plugin.json", JSON.stringify({ name: "x", network: { allowedHosts: ["api.stripe.com"] } })],
    ]);
    const result = scanSkillSecurity(bundle);
    const issue = result.issues.find((i) => i.ruleId === "network-egress-declared");
    expect(issue?.severity).toBe("low");
    expect(issue?.message).toContain("api.stripe.com");
    // Low severity alone must not fail or downgrade the scan.
    expect(result.status).toBe("pass");
  });
});
