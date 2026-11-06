import type { Org, Project, Skill } from "@skillist/ui";

export type NavSection =
  | "dashboard"
  | "agent"
  | "inventory"
  | "observability"
  | "coverage"
  | "governance"
  | "mirrors"
  | "settings";

/**
 * The rail section a path belongs to, or null when it belongs to none.
 *
 * Null is a real answer. Skill and project pages live under `/orgs` and are
 * marked by the tree row in the panel, and `/account` hangs off the user menu.
 * Falling back to "dashboard" here highlighted a section the reader wasn't in.
 */
export function activeSection(pathname: string): NavSection | null {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/governance")) return "governance";
  if (pathname.startsWith("/admin/mirrors")) return "mirrors";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/coverage")) return "coverage";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/agent")) return "agent";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  return null;
}

export type OrgView = {
  /** Whether the org belongs in the tree under the current filters. */
  visible: boolean;
  skills: Skill[];
  projects: Project[];
};

/**
 * What one org shows under the current filter and private-only toggle.
 *
 * This has to run per org *after* its skills and projects are known. Deciding
 * from the org's own name first is what made the filter unable to find a skill
 * in any org whose name didn't also match.
 *
 * An org that matches by name shows everything it has, so finding the org never
 * reads as the org being empty. `needle` is expected trimmed and lowercased.
 */
export function orgView({
  org,
  skills = [],
  projects = [],
  needle,
  privateOnly,
}: {
  org: Org;
  skills?: Skill[];
  projects?: Project[];
  needle: string;
  privateOnly: boolean;
}): OrgView {
  const orgMatches =
    !needle || org.name.toLowerCase().includes(needle) || org.slug.toLowerCase().includes(needle);

  const visibleSkills = skills.filter((skill) => {
    if (privateOnly && skill.visibility !== "private") return false;
    return orgMatches || skill.repo.toLowerCase().includes(needle);
  });

  // Private-only is a skills view: projects are curation, not skills, and they
  // carry their own visibility model, so they drop out while it's engaged.
  const visibleProjects = privateOnly
    ? []
    : projects.filter(
        (project) =>
          orgMatches ||
          project.name.toLowerCase().includes(needle) ||
          project.slug.toLowerCase().includes(needle),
      );

  return {
    visible: privateOnly
      ? visibleSkills.length > 0
      : orgMatches || visibleSkills.length > 0 || visibleProjects.length > 0,
    skills: visibleSkills,
    projects: visibleProjects,
  };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Screen-reader result summary for the filter; the visual tree speaks for itself. */
export function filterSummary(skills: number, projects: number): string {
  if (!skills && !projects) return "No matches";
  return `${count(skills, "skill")} and ${count(projects, "project")} shown`;
}
