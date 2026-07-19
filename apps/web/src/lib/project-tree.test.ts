import { describe, expect, it } from "vitest";
import type { ProjectItem } from "@/lib/api";
import {
  buildProjectTree,
  projectFolderPaths,
  projectItemDisplayPath,
  projectItemLeafName,
} from "./project-tree";

function skill(overrides: Partial<Extract<ProjectItem, { kind: "skill" }>>): ProjectItem {
  return {
    id: overrides.id ?? "i1",
    kind: "skill",
    path: overrides.path ?? "",
    position: overrides.position ?? 0,
    label: overrides.label ?? null,
    note: overrides.note ?? null,
    skillId: overrides.skillId ?? "s1",
    orgSlug: overrides.orgSlug ?? "acme",
    repo: overrides.repo ?? "review",
    visibility: overrides.visibility ?? "private",
    description: overrides.description ?? null,
  };
}

function external(overrides: Partial<Extract<ProjectItem, { kind: "external" }>>): ProjectItem {
  return {
    id: overrides.id ?? "e1",
    kind: "external",
    path: overrides.path ?? "",
    position: overrides.position ?? 0,
    label: overrides.label ?? null,
    note: overrides.note ?? null,
    externalUrl: overrides.externalUrl ?? "https://example.com",
    externalName: overrides.externalName ?? null,
  };
}

describe("projectItemLeafName", () => {
  it("prefers label, then repo, then external name", () => {
    expect(projectItemLeafName(skill({ label: "Reviewer" }))).toBe("Reviewer");
    expect(projectItemLeafName(skill({ repo: "sql-review" }))).toBe("sql-review");
    expect(projectItemLeafName(external({ externalName: "Docs" }))).toBe("Docs");
    expect(projectItemLeafName(external({ externalName: null }))).toBe("item");
  });
});

describe("projectItemDisplayPath", () => {
  it("prefixes the folder path when present", () => {
    expect(projectItemDisplayPath(skill({ path: "backend", repo: "review" }))).toBe(
      "backend/review",
    );
    expect(projectItemDisplayPath(skill({ path: "", repo: "review" }))).toBe("review");
  });
});

describe("projectFolderPaths", () => {
  it("returns distinct folder paths with every parent prefix, sorted", () => {
    const items: ProjectItem[] = [
      skill({ id: "a", path: "backend/db", repo: "migrate" }),
      skill({ id: "b", path: "backend", repo: "review" }),
      external({ id: "c", path: "references", externalName: "Guide" }),
    ];
    expect(projectFolderPaths(items)).toEqual(["backend", "backend/db", "references"]);
  });

  it("ignores root items and blank paths", () => {
    const items: ProjectItem[] = [
      skill({ id: "a", path: "", repo: "review" }),
      external({ id: "b", path: "   ", externalName: "Guide" }),
    ];
    expect(projectFolderPaths(items)).toEqual([]);
  });
});

describe("buildProjectTree", () => {
  it("nests items under their folder paths and maps leaves back to items", () => {
    const items: ProjectItem[] = [
      skill({ id: "a", path: "backend", repo: "review" }),
      skill({ id: "b", path: "backend/db", repo: "migrate" }),
      external({ id: "c", path: "", externalName: "Guide" }),
    ];
    const { nodes, itemByPath } = buildProjectTree(items);

    // Root: the "Guide" leaf and the "backend" folder.
    expect(nodes.map((n) => n.path).sort()).toEqual(["Guide", "backend"]);
    const backend = nodes.find((n) => n.path === "backend");
    expect(backend?.children).toBeDefined();
    expect(itemByPath.get("backend/review")?.id).toBe("a");
    expect(itemByPath.get("backend/db/migrate")?.id).toBe("b");
    expect(itemByPath.get("Guide")?.id).toBe("c");
  });

  it("disambiguates colliding display paths so every leaf maps to one item", () => {
    const items: ProjectItem[] = [
      skill({ id: "a", path: "", repo: "review" }),
      skill({ id: "b", path: "", repo: "review" }),
    ];
    const { itemByPath } = buildProjectTree(items);
    expect(itemByPath.get("review")?.id).toBe("a");
    expect(itemByPath.get("review (2)")?.id).toBe("b");
  });
});
