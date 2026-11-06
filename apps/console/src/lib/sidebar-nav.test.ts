import type { Org, Project, Skill } from "@skillist/ui";
import { describe, expect, it } from "vitest";
import { activeSection, filterSummary, orgView } from "./sidebar-nav";

const org = { id: "o1", name: "Acme Platform", slug: "acme" } as Org;
const skills = [
  { id: "s1", repo: "deploy-checklist", visibility: "private" },
  { id: "s2", repo: "pdf-tools", visibility: "public" },
] as Skill[];
const projects = [{ id: "p1", name: "Onboarding", slug: "new-hires" }] as Project[];

const view = (needle: string, privateOnly = false) =>
  orgView({ org, skills, projects, needle, privateOnly });
const repos = (v: ReturnType<typeof view>) => v.skills.map((s) => s.repo);

describe("orgView", () => {
  it("shows everything with no filters", () => {
    const v = view("");
    expect(v.visible).toBe(true);
    expect(v.skills).toHaveLength(2);
    expect(v.projects).toHaveLength(1);
  });

  it("finds a skill in an org whose name does not match", () => {
    const v = view("deploy");
    expect(v.visible).toBe(true);
    expect(repos(v)).toEqual(["deploy-checklist"]);
    expect(v.projects).toEqual([]);
  });

  it("finds a project by name or slug without surfacing unrelated skills", () => {
    for (const needle of ["onboarding", "new-hires"]) {
      const v = view(needle);
      expect(v.visible).toBe(true);
      expect(v.projects).toHaveLength(1);
      expect(v.skills).toEqual([]);
    }
  });

  it("keeps an org's contents when the match is on its name, not just its slug", () => {
    // Matching only the name used to render "No skills yet" over three skills.
    const v = view("platform");
    expect(v.skills).toHaveLength(2);
    expect(v.projects).toHaveLength(1);
  });

  it("hides an org with no match anywhere", () => {
    expect(view("zzz").visible).toBe(false);
  });

  it("limits to private skills and drops projects in private-only mode", () => {
    const v = view("", true);
    expect(repos(v)).toEqual(["deploy-checklist"]);
    expect(v.projects).toEqual([]);
  });

  it("applies private-only even when the org name matches", () => {
    expect(repos(view("acme", true))).toEqual(["deploy-checklist"]);
  });

  it("hides an org with no private skills in private-only mode", () => {
    const v = orgView({ org, skills: [skills[1]!], projects, needle: "", privateOnly: true });
    expect(v.visible).toBe(false);
  });

  it("treats data that has not loaded as nothing to match, not as a crash", () => {
    const v = orgView({ org, needle: "deploy", privateOnly: false });
    expect(v).toEqual({ visible: false, skills: [], projects: [] });
  });
});

describe("activeSection", () => {
  it("maps rail routes, including nested ones", () => {
    expect(activeSection("/dashboard")).toBe("dashboard");
    expect(activeSection("/settings/billing")).toBe("settings");
    expect(activeSection("/admin/mirrors")).toBe("mirrors");
  });

  it("claims no section for pages outside the rail", () => {
    expect(activeSection("/orgs/o1/skills/deploy-checklist")).toBeNull();
    expect(activeSection("/orgs/o1/projects/p1")).toBeNull();
    expect(activeSection("/account")).toBeNull();
  });
});

describe("filterSummary", () => {
  it("pluralises each count", () => {
    expect(filterSummary(1, 2)).toBe("1 skill and 2 projects shown");
  });

  it("says so when nothing matches", () => {
    expect(filterSummary(0, 0)).toBe("No matches");
  });
});
