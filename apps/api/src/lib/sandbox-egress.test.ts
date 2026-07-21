import { Sandbox as BaseSandbox, ContainerProxy } from "@cloudflare/sandbox";
import { describe, expect, it } from "vitest";
import { Sandbox } from "../durable-objects/sandbox";
import { SandboxHeavy } from "../durable-objects/sandbox-heavy";
import {
  BASELINE_ALLOWED_HOSTS,
  DENIED_HOSTS,
  HEAVY_ALLOWED_HOSTS,
  resolveRunAllowedHosts,
} from "./sandbox-egress";

// H3: the untrusted-skill sandboxes must run deny-by-default egress. These cover
// the policy shape and the subclass/proxy wiring. The actual runtime enforcement
// (allowlist gate, HTTP 520 on denied hosts) can only be verified on a real
// Cloudflare deploy — the local harness runs no container.

describe("sandbox egress policy", () => {
  it("baseline allowlist covers the common registry/source hosts", () => {
    expect(BASELINE_ALLOWED_HOSTS).toContain("github.com");
    expect(BASELINE_ALLOWED_HOSTS).toContain("registry.npmjs.org");
    expect(BASELINE_ALLOWED_HOSTS).toContain("pypi.org");
  });

  it("heavy allowlist is a strict superset adding the Cloudflare deploy hosts", () => {
    for (const host of BASELINE_ALLOWED_HOSTS) {
      expect(HEAVY_ALLOWED_HOSTS).toContain(host);
    }
    expect(HEAVY_ALLOWED_HOSTS).toContain("api.cloudflare.com");
    // The deploy hosts are heavy-only — the lite sandbox doesn't get them.
    expect(BASELINE_ALLOWED_HOSTS).not.toContain("api.cloudflare.com");
  });

  it("denies link-local/metadata, loopback, and every RFC1918 range", () => {
    expect(DENIED_HOSTS).toContain("169.254.*");
    expect(DENIED_HOSTS).toContain("127.*");
    expect(DENIED_HOSTS).toContain("10.*");
    expect(DENIED_HOSTS).toContain("192.168.*");
    for (let octet = 16; octet <= 31; octet++) {
      expect(DENIED_HOSTS).toContain(`172.${octet}.*`);
    }
  });
});

describe("sandbox subclass + proxy wiring", () => {
  it("Sandbox and SandboxHeavy extend the SDK Sandbox", () => {
    expect(Sandbox.prototype instanceof BaseSandbox).toBe(true);
    expect(SandboxHeavy.prototype instanceof BaseSandbox).toBe(true);
  });

  it("ContainerProxy is exportable (required for egress interception to apply)", () => {
    expect(typeof ContainerProxy).toBe("function");
  });
});

describe("resolveRunAllowedHosts (per-skill manifest egress)", () => {
  it("adds declared hosts onto the runtime baseline", () => {
    const lite = resolveRunAllowedHosts(false, ["api.stripe.com"]);
    for (const host of BASELINE_ALLOWED_HOSTS) expect(lite).toContain(host);
    expect(lite).toContain("api.stripe.com");

    const heavy = resolveRunAllowedHosts(true, ["api.stripe.com"]);
    expect(heavy).toContain("api.cloudflare.com"); // heavy baseline
    expect(heavy).toContain("api.stripe.com");
  });

  it("drops catch-all/invalid declared patterns (can't re-open egress)", () => {
    const merged = resolveRunAllowedHosts(false, ["*", "*.*", "*.com", "evil.example.com"]);
    expect(merged).toContain("evil.example.com");
    expect(merged).not.toContain("*");
    expect(merged).not.toContain("*.*");
    expect(merged).not.toContain("*.com");
  });

  it("dedupes a declared host that is already in the baseline", () => {
    const merged = resolveRunAllowedHosts(false, ["github.com"]);
    expect(merged.filter((h) => h === "github.com")).toHaveLength(1);
  });
});
