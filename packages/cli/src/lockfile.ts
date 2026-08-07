import { access, readFile, writeFile } from "node:fs/promises";

export const LOCKFILE = ".skillist.lock";

export type LockEntry = {
  org: string;
  repo: string;
  version: string;
  installedAt: string;
  path: string;
  /** Full sha256 of the installed SKILL.md, verified against delivery meta. */
  contentSha256?: string;
};

export type Lockfile = {
  version: 1;
  skills: LockEntry[];
};

export async function readLockfile(): Promise<Lockfile> {
  try {
    await access(LOCKFILE);
    const raw = await readFile(LOCKFILE, "utf8");
    const parsed = JSON.parse(raw) as {
      version: 1;
      skills: Array<{
        org: string;
        repo?: string;
        skill?: string;
        version: string;
        installedAt: string;
        path: string;
        contentSha256?: string;
      }>;
    };
    // Migrate legacy lock entries that used `skill` instead of `repo`.
    return {
      version: 1,
      skills: parsed.skills.map((s) => ({
        org: s.org,
        repo: s.repo ?? s.skill ?? "",
        version: s.version,
        installedAt: s.installedAt,
        path: s.path,
        // Preserved on read: `sync` uses it as the integrity baseline, so
        // dropping it here would silently disable drift verification.
        ...(s.contentSha256 ? { contentSha256: s.contentSha256 } : {}),
      })),
    };
  } catch {
    return { version: 1, skills: [] };
  }
}

export async function writeLockfile(lock: Lockfile) {
  await writeFile(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

/** Upserts an entry by org/repo, preserving lockfile ordering. */
export function upsertLockEntry(lock: Lockfile, entry: LockEntry): Lockfile {
  const existing = lock.skills.findIndex((s) => s.org === entry.org && s.repo === entry.repo);
  if (existing >= 0) lock.skills[existing] = entry;
  else lock.skills.push(entry);
  return lock;
}
