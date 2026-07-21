/**
 * Deny-by-default egress policy for the untrusted-skill-execution sandboxes.
 *
 * The stock `@cloudflare/sandbox` class runs with `enableInternet = true` and no
 * host rules, so skill scripts can reach any host — an exfiltration / SSRF hole.
 * The `Sandbox` / `SandboxHeavy` subclasses apply the values here: with
 * `enableInternet = false` plus a non-empty `allowedHosts`, the runtime's egress
 * chain blocks (HTTP 520) every host that isn't on the allowlist, and forwards
 * allowed hosts to the internet. `deniedHosts` is an unconditional blocklist that
 * wins over everything.
 *
 * IMPORTANT: this only takes effect when the Worker entry exports `ContainerProxy`
 * (see apps/api/src/index.ts) — without that export the interception silently
 * no-ops and egress stays open. Enforcement can only be verified against a real
 * Cloudflare deploy; the local test harness runs no container.
 *
 * Hosts a legitimate skill needs but that aren't covered here are a deliberate
 * follow-up: derive a per-skill allowlist from the agentskills.io manifest and
 * apply it at runtime via `sandbox.setAllowedHosts(...)`, so each run opens only
 * the hosts it declares instead of widening this shared baseline.
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
