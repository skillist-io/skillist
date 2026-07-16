export type SemverBump = "major" | "minor" | "patch";

export function bumpSemver(version: string, bump: SemverBump = "patch"): string {
  const parts = version.split(".").map((n) => Number(n) || 0);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function resolveNextSemver(
  current: string | null | undefined,
  options: { semver?: string; bump?: SemverBump },
): string {
  if (options.semver) return options.semver;
  if (current) return bumpSemver(current, options.bump ?? "patch");
  return "0.1.0";
}
