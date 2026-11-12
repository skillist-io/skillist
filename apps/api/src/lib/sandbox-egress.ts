import { isAllowedHostPattern } from "@skillist/skill-format";

/**
 * Deny-by-default egress policy for the untrusted-skill-execution sandboxes.
 *
 * Containers start with `enableInternet: false`, and `SkillSandbox` routes ports 80
 * and 443 through the `Outbound` entrypoint, which applies `isOutboundAllowed`. Every
 * other port stays blocked. `DENIED_HOSTS` wins over everything, and it is a constant
 * here rather than a per-run value, so nothing a caller passes can loosen it.
 *
 * Each run gets the baseline plus the hosts its manifest declares, fixed when the
 * container starts. Fresh sandbox per run, so nothing reaches the next tenant.
 */

/**
 * Baseline allowlist for the lite `Sandbox` (general skill execution): the
 * package registries and source hosts skills routinely need to install deps or
 * clone. Glob patterns match the same way `allowedHosts` does in the runtime.
 */
export const BASELINE_ALLOWED_HOSTS: string[] = [
  // npm
  "registry.npmjs.org",
  "*.npmjs.org",
  // PyPI
  "pypi.org",
  "*.pypi.org",
  "files.pythonhosted.org",
  // Git / source
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "*.githubusercontent.com",
];

/**
 * The heavy `SandboxHeavy` runs infra/deploy skills (wrangler), so it also needs
 * the Cloudflare deploy toolchain hosts on top of the baseline.
 */
export const HEAVY_ALLOWED_HOSTS: string[] = [
  ...BASELINE_ALLOWED_HOSTS,
  "api.cloudflare.com",
  "*.cloudflare.com",
  "*.workers.dev",
];

/**
 * Unconditionally-blocked hosts (belt-and-suspenders on top of the allowlist):
 * link-local/metadata and RFC1918 private ranges, plus loopback and `.internal`.
 * Cloudflare containers don't run on AWS/GCP so there's no classic IMDS to steal
 * from, and `enableInternet = false` already blocks these — but denying them
 * outright keeps the intent explicit and survives any future allowlist widening.
 */
export const DENIED_HOSTS: string[] = [
  "169.254.*", // link-local / cloud metadata
  "127.*", // loopback
  "10.*", // RFC1918
  "192.168.*", // RFC1918
  // RFC1918 172.16.0.0/12 → 172.16.* … 172.31.*
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`),
  "localhost",
  "*.internal",
];

/** "*" matches any run of characters, including dots. */
function hostMatches(pattern: string, hostname: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`).test(hostname);
}

/** The whole outbound policy. Denied hosts first, then the allowlist. */
export function isOutboundAllowed(hostname: string, allowedHosts: string[]): boolean {
  // Hostnames are case-insensitive, and `example.com.` is the same host as
  // `example.com`, so either spelling must not slip past a rule.
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (DENIED_HOSTS.some((pattern) => hostMatches(pattern, host))) return false;
  return allowedHosts.some((pattern) => hostMatches(pattern, host));
}

/**
 * Merge a skill's manifest-declared `network.allowedHosts` onto the sandbox
 * baseline for one run. Declared hosts are re-validated with the same rule the
 * publish-time schema uses (defense-in-depth for bundles that predate the check),
 * so a catch-all pattern can't slip through and re-open egress. `deniedHosts` is
 * unaffected — internal ranges stay blocked regardless of what a skill declares.
 */
export function resolveRunAllowedHosts(isHeavy: boolean, declaredHosts: string[]): string[] {
  const baseline = isHeavy ? HEAVY_ALLOWED_HOSTS : BASELINE_ALLOWED_HOSTS;
  const safeDeclared = declaredHosts
    .map((host) => host.trim().toLowerCase())
    .filter((host) => isAllowedHostPattern(host));
  return [...new Set([...baseline, ...safeDeclared])];
}
