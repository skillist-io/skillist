import {
  auditEvents,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  sessions,
  skillRuns,
  telemetryEvents,
  verifications,
} from "@skillist/db/schema";
import { and, eq, isNull, lt, notExists, sql } from "drizzle-orm";
import { inList, type WorkerDb } from "./db";

/**
 * Scheduled data retention.
 *
 * Six tables previously grew without bound — nothing pruned them, and the
 * privacy policy had to say so. Each window below is what that page states, so
 * changing one here means changing that page too.
 *
 * Deletes are bounded per run rather than issued as one unbounded statement: a
 * DELETE matching millions of rows holds a long lock on a table the request
 * path is actively reading. Whatever is left over is picked up by the next
 * daily run, so the steady state converges without a maintenance window.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Max rows any single rule removes per run. */
export const RETENTION_BATCH = 5_000;

export const RETENTION = {
  /** Expired sessions, kept briefly so "recently signed out" still resolves. */
  sessionsAfterExpiryDays: 7,
  /** Magic-link / OTP challenges. Useless the moment they expire. */
  verificationsAfterExpiryDays: 1,
  /** MCP OAuth grants, once the refresh token is dead too. */
  oauthTokensAfterExpiryDays: 7,
  /** Anonymously registered MCP clients that nobody ever authorized. */
  oauthAbandonedClientDays: 30,
  /** Run logs are user data: whatever the script printed. */
  runOutputDays: 30,
  runRowDays: 180,
  /** Install/activation events. The published counters are columns, not rows,
   * so pruning these changes no visible count. */
  telemetryDays: 90,
  /** Audit is a security record: long horizon, and never silently. */
  auditDays: 400,
} as const;

export type RetentionReport = Record<string, number>;

function cutoff(now: number, days: number): Date {
  return new Date(now - days * DAY_MS);
}

/**
 * Applies every retention rule once.
 *
 * Returns per-rule row counts so the caller can log what it did — silent
 * pruning is how you discover months later that a rule was deleting far more
 * than intended.
 *
 * D1 builds without `DELETE ... LIMIT`, so each rule selects a bounded set of ids
 * and deletes by primary key.
 */
export async function applyRetention(db: WorkerDb, now = Date.now()): Promise<RetentionReport> {
  const report: RetentionReport = {};

  const expiredSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.expiresAt, cutoff(now, RETENTION.sessionsAfterExpiryDays)))
    .limit(RETENTION_BATCH);
  if (expiredSessions.length > 0) {
    await db.delete(sessions).where(
      inList(
        sessions.id,
        expiredSessions.map((r) => r.id),
      ),
    );
  }
  report.sessions = expiredSessions.length;

  const expiredVerifications = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(lt(verifications.expiresAt, cutoff(now, RETENTION.verificationsAfterExpiryDays)))
    .limit(RETENTION_BATCH);
  if (expiredVerifications.length > 0) {
    await db.delete(verifications).where(
      inList(
        verifications.id,
        expiredVerifications.map((r) => r.id),
      ),
    );
  }
  report.verifications = expiredVerifications.length;

  // Deleting a refresh token cascades to the access-token rows issued from it.
  // Rows with no refresh token are handled by the rule after this one.
  const expiredTokens = await db
    .select({ id: oauthRefreshTokens.id })
    .from(oauthRefreshTokens)
    .where(lt(oauthRefreshTokens.expiresAt, cutoff(now, RETENTION.oauthTokensAfterExpiryDays)))
    .limit(RETENTION_BATCH);
  if (expiredTokens.length > 0) {
    await db.delete(oauthRefreshTokens).where(
      inList(
        oauthRefreshTokens.id,
        expiredTokens.map((r) => r.id),
      ),
    );
  }
  report.oauthRefreshTokens = expiredTokens.length;

  const expiredAccessTokens = await db
    .select({ id: oauthAccessTokens.id })
    .from(oauthAccessTokens)
    .where(lt(oauthAccessTokens.expiresAt, cutoff(now, RETENTION.oauthTokensAfterExpiryDays)))
    .limit(RETENTION_BATCH);
  if (expiredAccessTokens.length > 0) {
    await db.delete(oauthAccessTokens).where(
      inList(
        oauthAccessTokens.id,
        expiredAccessTokens.map((r) => r.id),
      ),
    );
  }
  report.oauthAccessTokens = expiredAccessTokens.length;

  const expiredAssertions = await db
    .select({ id: oauthClientAssertions.id })
    .from(oauthClientAssertions)
    .where(lt(oauthClientAssertions.expiresAt, cutoff(now, RETENTION.oauthTokensAfterExpiryDays)))
    .limit(RETENTION_BATCH);
  if (expiredAssertions.length > 0) {
    await db.delete(oauthClientAssertions).where(
      inList(
        oauthClientAssertions.id,
        expiredAssertions.map((r) => r.id),
      ),
    );
  }
  report.oauthClientAssertions = expiredAssertions.length;

  // Registration is open to anyone, so this is the one table an unauthenticated
  // caller can grow. A client with a consent or a refresh token is in use.
  const abandonedClients = await db
    .select({ clientId: oauthClients.clientId })
    .from(oauthClients)
    .where(
      and(
        isNull(oauthClients.userId),
        lt(oauthClients.createdAt, cutoff(now, RETENTION.oauthAbandonedClientDays)),
        notExists(
          db
            .select({ id: oauthConsents.id })
            .from(oauthConsents)
            .where(eq(oauthConsents.clientId, oauthClients.clientId)),
        ),
        notExists(
          db
            .select({ id: oauthRefreshTokens.id })
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.clientId, oauthClients.clientId)),
        ),
      ),
    )
    .limit(RETENTION_BATCH);
  if (abandonedClients.length > 0) {
    await db.delete(oauthClients).where(
      inList(
        oauthClients.clientId,
        abandonedClients.map((r) => r.clientId),
      ),
    );
  }
  report.oauthAbandonedClients = abandonedClients.length;

  // Blank the output but keep the row: status, timing, and exit code stay
  // available for observability long after the logs themselves should be gone.
  const scrubbed = await db
    .select({ id: skillRuns.id })
    .from(skillRuns)
    .where(
      and(
        lt(skillRuns.createdAt, cutoff(now, RETENTION.runOutputDays)),
        sql`(${skillRuns.stdout} IS NOT NULL OR ${skillRuns.stderr} IS NOT NULL)`,
      ),
    )
    .limit(RETENTION_BATCH);
  if (scrubbed.length > 0) {
    await db
      .update(skillRuns)
      .set({ stdout: null, stderr: null })
      .where(
        inList(
          skillRuns.id,
          scrubbed.map((r) => r.id),
        ),
      );
  }
  report.skillRunOutputScrubbed = scrubbed.length;

  const oldRuns = await db
    .select({ id: skillRuns.id })
    .from(skillRuns)
    .where(lt(skillRuns.createdAt, cutoff(now, RETENTION.runRowDays)))
    .limit(RETENTION_BATCH);
  if (oldRuns.length > 0) {
    await db.delete(skillRuns).where(
      inList(
        skillRuns.id,
        oldRuns.map((r) => r.id),
      ),
    );
  }
  report.skillRuns = oldRuns.length;

  const oldTelemetry = await db
    .select({ id: telemetryEvents.id })
    .from(telemetryEvents)
    .where(lt(telemetryEvents.createdAt, cutoff(now, RETENTION.telemetryDays)))
    .limit(RETENTION_BATCH);
  if (oldTelemetry.length > 0) {
    await db.delete(telemetryEvents).where(
      inList(
        telemetryEvents.id,
        oldTelemetry.map((r) => r.id),
      ),
    );
  }
  report.telemetryEvents = oldTelemetry.length;

  const oldAudit = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(lt(auditEvents.createdAt, cutoff(now, RETENTION.auditDays)))
    .limit(RETENTION_BATCH);
  if (oldAudit.length > 0) {
    await db.delete(auditEvents).where(
      inList(
        auditEvents.id,
        oldAudit.map((r) => r.id),
      ),
    );
  }
  report.auditEvents = oldAudit.length;

  return report;
}

/** True when a rule hit its batch cap, so the next run still has work to do. */
export function hasMoreWork(report: RetentionReport): boolean {
  return Object.values(report).some((n) => n >= RETENTION_BATCH);
}
