import type { SyncQueueMessage } from "@skillist/contracts";
import { skillSources } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../env";
import { createWorkerDb } from "../db";
import { discoverOfficialSources } from "../github-discover";
import {
  finalizeSourceSync,
  listEnabledSourceIds,
  mirrorPublishSkill,
  recordPublishJobFailure,
  recordPublishJobSuccess,
} from "./mirror-publish";

export async function handleSyncQueueMessage(env: Env, message: SyncQueueMessage): Promise<void> {
  const db = createWorkerDb(env);

  switch (message.type) {
    case "sync_all": {
      const ids = await listEnabledSourceIds(db);
      for (const sourceId of ids) {
        await env.SYNC_WORKFLOW.create({
          id: `sync-${sourceId}-${Date.now()}`,
          params: { sourceId },
        });
      }
      return;
    }
    case "sync_source": {
      await env.SYNC_WORKFLOW.create({
        id: `sync-${message.sourceId}-${Date.now()}`,
        params: { sourceId: message.sourceId },
      });
      return;
    }
    case "discover_sources": {
      await discoverOfficialSources(env, db);
      return;
    }
    case "publish_skill": {
      try {
        await mirrorPublishSkill(env, db, {
          sourceId: message.sourceId,
          skillSlug: message.skillSlug,
          sourcePath: message.sourcePath,
          commitSha: message.commitSha,
        });
      } catch (err) {
        // One bad vendor skill must not poison the whole source sync batch.
        console.warn(
          JSON.stringify({
            msg: "mirror_publish_skipped",
            sourceId: message.sourceId,
            skillSlug: message.skillSlug,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      const readyToFinalize = await recordPublishJobSuccess(
        db,
        message.sourceId,
        message.commitSha,
      );
      if (readyToFinalize) {
        await finalizeSourceSync(db, message.sourceId, message.commitSha);
      }
      return;
    }
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
    }
  }
}

export async function enqueueSyncForGithubRepo(
  env: Env,
  owner: string,
  repo: string,
): Promise<string | null> {
  const db = createWorkerDb(env);
  const [source] = await db
    .select({ id: skillSources.id })
    .from(skillSources)
    .where(
      and(
        eq(skillSources.githubOwner, owner),
        eq(skillSources.githubRepo, repo),
        eq(skillSources.syncEnabled, true),
      ),
    )
    .limit(1);
  if (!source) return null;
  await env.SYNC_QUEUE.send({ type: "sync_source", sourceId: source.id });
  return source.id;
}
