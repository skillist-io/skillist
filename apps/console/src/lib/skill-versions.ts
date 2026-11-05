import { compareSemver } from "@skillist/skill-format";
import type { SkillVersion } from "@skillist/ui";

export type VersionState = {
  /** Every version, newest first. The API returns them in no particular order. */
  ordered: SkillVersion[];
  /** The live version. */
  published: SkillVersion | undefined;
  /** Unpublished work: the newest draft, if it's newer than what's live. */
  draft: SkillVersion | undefined;
  /**
   * What the editor opens: the draft, else the live version. Falling back to an
   * arbitrary row would open an archived version's files as if they were current.
   */
  base: SkillVersion | undefined;
  /** The highest version ever saved. New versions must go past it, including archived ones. */
  newest: SkillVersion | undefined;
};

export function resolveVersions(versions: SkillVersion[] | undefined): VersionState {
  const ordered = [...(versions ?? [])].sort((a, b) => compareSemver(b.semver, a.semver));
  const published = ordered.find((v) => v.status === "published");
  const latestDraft = ordered.find((v) => v.status === "draft");
  const draft =
    latestDraft && (!published || compareSemver(latestDraft.semver, published.semver) > 0)
      ? latestDraft
      : undefined;
  const newest = ordered[0];
  return { ordered, published, draft, base: draft ?? published ?? newest, newest };
}
