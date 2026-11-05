import type { Env } from "../env";
import { alertBackgroundError } from "./alert";

/** D1's per-database limit, which can't be raised. */
const D1_MAX_BYTES = 10 * 1024 ** 3;

/**
 * Warn with room to act. At the cap writes fail outright, and moving a growing
 * table elsewhere is a project, not a same-day fix.
 */
const ALERT_AT_BYTES = D1_MAX_BYTES * 0.7;

/** Logs the database size and alerts when it nears the cap. Run from the daily cron. */
export async function checkDatabaseSize(env: Env): Promise<void> {
  const { meta } = await env.DB.prepare("SELECT 1").run();
  const bytes = meta.size_after;
  console.log(JSON.stringify({ msg: "database_size", bytes }));
  if (bytes < ALERT_AT_BYTES) return;

  const percent = Math.round((bytes / D1_MAX_BYTES) * 100);
  const { alerting } = alertBackgroundError(
    env,
    new Error(`D1 is at ${percent}% of its 10 GB limit`),
    "cron:database-size",
  );
  await alerting;
}
