import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { createWorkerDb } from "../lib/db";
import { beginSourcePublishBatch, finalizeSourceSync, syncSource } from "../lib/github-sync";

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

    if (result.changedSkills.length === 0) {
      await step.do("finalize", async () => {
        await finalizeSourceSync(db, sourceId, commitSha);
        return { ok: true };
      });
      return result;
    }

    await step.do("begin-publish-batch", async () => {
      await beginSourcePublishBatch(db, sourceId, commitSha, result.changedSkills.length);
      return { pending: result.changedSkills.length };
    });

    await step.do("enqueue-publish-jobs", async () => {
      // Queues sendBatch allows at most 100 messages per call.
      const BATCH = 100;
      const messages = result.changedSkills.map((skill) => ({
        body: {
          type: "publish_skill" as const,
          sourceId,
          skillSlug: skill.skillSlug,
          sourcePath: skill.sourcePath,
          commitSha,
        },
      }));
      for (let i = 0; i < messages.length; i += BATCH) {
        await this.env.SYNC_QUEUE.sendBatch(messages.slice(i, i + BATCH));
      }
      return { enqueued: messages.length };
    });

    return result;
  }
}
