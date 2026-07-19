import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { mineSkillFailures } from "../lib/failure-mining";

export type FailureMiningParams = {
  skillId: string;
};

/**
 * Durable per-skill failure mining: clusters recent run/eval failures and opens
 * agent-sourced feedback for recurring patterns. Cron-dispatched from
 * `scheduled()` (one workflow instance per skill with recent failures).
 */
export class FailureMiningWorkflow extends WorkflowEntrypoint<Env, FailureMiningParams> {
  async run(event: WorkflowEvent<FailureMiningParams>, step: WorkflowStep) {
    const { skillId } = event.payload;
    const db = createWorkerDb(this.env);

    return step.do("mine-failures", async () => {
      return mineSkillFailures(this.env, db, skillId);
    });
  }
}
