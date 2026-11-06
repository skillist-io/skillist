import { describe, expect, it } from "vitest";
import {
  BASELINE_ALLOWED_HOSTS,
  DENIED_HOSTS,
  HEAVY_ALLOWED_HOSTS,
  isOutboundAllowed,
  resolveRunAllowedHosts,
} from "./sandbox-egress";

// H3: the untrusted-skill sandboxes must run deny-by-default egress. These cover
// the policy itself. Enforcement needs real containers, which this harness doesn't
// run, so it has to be checked against `wrangler dev` or a deploy.

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

describe("isOutboundAllowed", () => {
  const allowed = ["github.com", "*.npmjs.org"];

  it("allows listed hosts and wildcard matches", () => {
    expect(isOutboundAllowed("github.com", allowed)).toBe(true);
    expect(isOutboundAllowed("registry.npmjs.org", allowed)).toBe(true);
  });

  it("blocks everything else, including an empty allowlist", () => {
    expect(isOutboundAllowed("example.com", allowed)).toBe(false);
    expect(isOutboundAllowed("github.com", [])).toBe(false);
  });

  it("treats dots in a pattern literally", () => {
    expect(isOutboundAllowed("githubxcom", allowed)).toBe(false);
  });

  it("isn't fooled by lookalike hosts", () => {
    expect(isOutboundAllowed("github.com.evil.example", allowed)).toBe(false);
    expect(isOutboundAllowed("evilgithub.com", allowed)).toBe(false);
    expect(isOutboundAllowed("npmjs.org.evil.example", allowed)).toBe(false);
  });

  it("isn't fooled by case or a trailing dot", () => {
    expect(isOutboundAllowed("GitHub.COM", allowed)).toBe(true);
    expect(isOutboundAllowed("github.com.", allowed)).toBe(true);
    expect(isOutboundAllowed("LOCALHOST", ["*"])).toBe(false);
    expect(isOutboundAllowed("metadata.internal.", ["*"])).toBe(false);
  });

  it("lets denied hosts win over any allowlist", () => {
    for (const host of ["169.254.169.254", "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.20.0.1"]) {
      expect(isOutboundAllowed(host, ["*"])).toBe(false);
    }
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
