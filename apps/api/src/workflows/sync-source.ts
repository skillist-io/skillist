import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { finalizeSourceSync, syncSource } from "../lib/github-sync";

export type SyncSourceParams = {
  sourceId: string;
};

/**
 * Durable multi-step sync for one curated GitHub skill source.
 * Discovers changed skills and enqueues per-skill publish (+ eval) jobs.
 */
export class SyncSourceWorkflow extends WorkflowEntrypoint<Env, SyncSourceParams> {
  async run(event: WorkflowEvent<SyncSourceParams>, step: WorkflowStep) {
    const { sourceId } = event.payload;
    const db = createWorkerDb(this.env);

    const result = await step.do("sync-source", async () => {
      return syncSource(this.env, db, sourceId);
    });

    if (result.skipped || !result.commitSha) {
      return result;
    }

    const commitSha = result.commitSha;

    await step.do("enqueue-publish-jobs", async () => {
      if (result.changedSkills.length === 0) return { enqueued: 0 };
      await this.env.SYNC_QUEUE.sendBatch(
        result.changedSkills.map((skill) => ({
          body: {
            type: "publish_skill" as const,
            sourceId,
            skillSlug: skill.skillSlug,
            sourcePath: skill.sourcePath,
            commitSha,
          },
        })),
      );
      return { enqueued: result.changedSkills.length };
    });

    await step.do("finalize", async () => {
      await finalizeSourceSync(db, sourceId, commitSha);
      return { ok: true };
    });

    return result;
  }
}
