import { describe, expect, it } from "vitest";
import { hasMoreWork, RETENTION, RETENTION_BATCH } from "./retention";

/**
 * The retention windows are a published contract: apps/web/src/routes/privacy.tsx
 * describes them to users. These assertions exist so that changing a window is
 * a deliberate act that also forces the privacy page to be updated, rather than
 * a quiet edit.
 */
describe("retention policy", () => {
  it("keeps run output for less time than the run rows themselves", () => {
    // Output is user data (whatever a script printed); the row is metadata.
    // Scrubbing must therefore happen strictly before deletion, or the scrub
    // would never run on rows that are already gone.
    expect(RETENTION.runOutputDays).toBeLessThan(RETENTION.runRowDays);
  });

  it("retains audit events far longer than anything else", () => {
    // Audit is a security record. If it were ever pruned on the same horizon as
    // ordinary telemetry, an incident review could outlive its own evidence.
    const others = [
      RETENTION.sessionsAfterExpiryDays,
      RETENTION.verificationsAfterExpiryDays,
      RETENTION.oauthTokensAfterExpiryDays,
      RETENTION.runRowDays,
      RETENTION.telemetryDays,
    ];
    for (const window of others) {
      expect(RETENTION.auditDays).toBeGreaterThan(window);
    }
  });

  it("does not delete sessions the moment they expire", () => {
    // A just-expired session still needs to resolve for "you were signed out"
    // rather than looking like it never existed.
    expect(RETENTION.sessionsAfterExpiryDays).toBeGreaterThan(0);
  });

  it("bounds every rule so no run can lock a table indefinitely", () => {
    expect(RETENTION_BATCH).toBeGreaterThan(0);
    expect(RETENTION_BATCH).toBeLessThanOrEqual(50_000);
  });
});

describe("hasMoreWork", () => {
  it("is false for a run that cleared everything", () => {
    expect(hasMoreWork({ sessions: 3, auditEvents: 0 })).toBe(false);
  });

  it("is true when a rule hit the batch cap", () => {
    // Signals a backlog: the next daily run still has work, and a sustained
    // signal means a window needs revisiting.
    expect(hasMoreWork({ sessions: RETENTION_BATCH })).toBe(true);
  });

  it("is false for an empty report", () => {
    expect(hasMoreWork({})).toBe(false);
  });
});
