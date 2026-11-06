import { SkillSandbox } from "./skill-sandbox";

/**
 * The heavy skill-execution sandbox, for wrangler/deploy/infra skills. Its wider
 * allowlist comes from `resolveRunAllowedHosts`. The exported name stays
 * `SandboxHeavy` so wrangler config and the Durable Object migration don't change.
 */
export class SandboxHeavy extends SkillSandbox {
  protected readonly instance = "standard-1";
}
