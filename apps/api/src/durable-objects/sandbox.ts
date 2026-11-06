import { SkillSandbox } from "./skill-sandbox";

/**
 * The lite skill-execution sandbox. The exported name stays `Sandbox` so the
 * wrangler binding and Durable Object migration are unchanged.
 */
export class Sandbox extends SkillSandbox {
  protected readonly instance = "basic";
}
