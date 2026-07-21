import { Sandbox as BaseSandbox } from "@cloudflare/sandbox";
import { BASELINE_ALLOWED_HOSTS, DENIED_HOSTS } from "../lib/sandbox-egress";

/**
 * The lite skill-execution sandbox, locked down to deny-by-default egress.
 *
 * Subclassing (rather than re-exporting the stock class) is the only way to set
 * the egress policy — these are read by the container runtime at start time, not
 * the constructor, so class fields are the documented mechanism. The exported
 * name stays `Sandbox` so `wrangler.jsonc`'s `class_name` and the DO migration
 * are unchanged. Egress interception also requires `export { ContainerProxy }`
 * from the Worker entry (src/index.ts) — see lib/sandbox-egress.ts.
 */
export class Sandbox extends BaseSandbox {
  enableInternet = false;
  allowedHosts = BASELINE_ALLOWED_HOSTS;
  deniedHosts = DENIED_HOSTS;
}
