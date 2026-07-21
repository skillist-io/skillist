import { Sandbox as BaseSandbox } from "@cloudflare/sandbox";
import { DENIED_HOSTS, HEAVY_ALLOWED_HOSTS } from "../lib/sandbox-egress";

/**
 * The heavy skill-execution sandbox (wrangler/deploy/infra skills), locked down
 * to deny-by-default egress. Same mechanism and constraints as `Sandbox` — see
 * durable-objects/sandbox.ts and lib/sandbox-egress.ts — but with the Cloudflare
 * deploy toolchain hosts added to the allowlist. Exported name stays
 * `SandboxHeavy` so wrangler config and the DO migration don't change.
 */
export class SandboxHeavy extends BaseSandbox {
  enableInternet = false;
  allowedHosts = HEAVY_ALLOWED_HOSTS;
  deniedHosts = DENIED_HOSTS;
}
