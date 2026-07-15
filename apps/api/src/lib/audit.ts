import { auditEvents } from "@skillist/db/schema";
import type { WorkerDb } from "./db";

export async function logAudit(
  db: WorkerDb,
  event: {
    orgId?: string | null;
    actorId?: string | null;
    actorType: "user" | "api_key" | "system";
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    orgId: event.orgId ?? null,
    actorId: event.actorId ?? null,
    actorType: event.actorType,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? null,
  });
}
