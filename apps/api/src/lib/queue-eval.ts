import { and, eq, inArray, desc } from "drizzle-orm";
import { skillEvals } from "@skillist/db/schema";
import type { Env } from "../env";
import type { WorkerDb } from "./db";

export type QueueEvalInput = {
  skillId: string;
  versionId: string;
  orgSlug: string;
  skillRepo: string;
  scenarios?: { name: string; prompt: string }[] | null;
};

export async function getVersionEvalStatus(
  db: WorkerDb,
  versionId: string,
): Promise<{
  id: string;
  status: string;
  uplift: number | null;
} | null> {
  const [row] = await db
    .select({
      id: skillEvals.id,
      status: skillEvals.status,
      uplift: skillEvals.uplift,
    })
    .from(skillEvals)
    .where(eq(skillEvals.versionId, versionId))
    .orderBy(desc(skillEvals.createdAt))
    .limit(1);
  return row ?? null;
}

export async function queueSkillEval(
  env: Env,
  db: WorkerDb,
  input: QueueEvalInput,
): Promise<{ evalId: string; status: string; created: boolean }> {
  const [pending] = await db
    .select({
      id: skillEvals.id,
      status: skillEvals.status,
    })
    .from(skillEvals)
    .where(
      and(
        eq(skillEvals.versionId, input.versionId),
        inArray(skillEvals.status, ["queued", "running"]),
      ),
    )
    .limit(1);

  if (pending) {
    return { evalId: pending.id, status: pending.status, created: false };
  }

  const [evalRow] = await db
    .insert(skillEvals)
    .values({
      skillId: input.skillId,
      versionId: input.versionId,
      scenarios: input.scenarios ?? null,
      status: "queued",
    })
    .returning();

  await env.AI_QUEUE.send({
    type: "eval",
    evalId: evalRow!.id,
    skillId: input.skillId,
    versionId: input.versionId,
    orgSlug: input.orgSlug,
    skillRepo: input.skillRepo,
  });

  return { evalId: evalRow!.id, status: "queued", created: true };
}
