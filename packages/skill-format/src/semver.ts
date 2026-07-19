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

/**
 * Compares two `major.minor.patch` versions numerically, ignoring any
 * prerelease/build suffix. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Non-numeric segments are treated as 0 (inputs are regex-gated upstream).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a
    .split("+")[0]!
    .split("-")[0]!
    .split(".")
    .map((n) => Number(n) || 0);
  const pb = b
    .split("+")[0]!
    .split("-")[0]!
    .split(".")
    .map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function resolveNextSemver(
  current: string | null | undefined,
  options: { semver?: string; bump?: SemverBump },
): string {
  if (options.semver) return options.semver;
  if (current) return bumpSemver(current, options.bump ?? "patch");
  return "0.1.0";
}
