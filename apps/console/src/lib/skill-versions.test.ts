import type { SkillVersion } from "@skillist/ui";
import { describe, expect, it } from "vitest";
import { resolveVersions } from "./skill-versions";

const version = (semver: string, status: string) =>
  ({ id: semver, skillId: "s", semver, status }) as SkillVersion;

describe("resolveVersions", () => {
  it("opens the live version, not an archived one listed first", () => {
    const state = resolveVersions([version("0.1.0", "archived"), version("0.1.1", "published")]);
    expect(state.base?.semver).toBe("0.1.1");
    expect(state.draft).toBeUndefined();
  });

  it("prefers the newest draft over older ones", () => {
    const state = resolveVersions([
      version("1.0.0", "published"),
      version("1.1.0", "draft"),
      version("1.2.0", "draft"),
    ]);
    expect(state.draft?.semver).toBe("1.2.0");
    expect(state.base?.semver).toBe("1.2.0");
  });

  it("doesn't count a draft a later publish left behind", () => {
    const state = resolveVersions([version("1.1.0", "draft"), version("1.2.0", "published")]);
    expect(state.draft).toBeUndefined();
    expect(state.base?.semver).toBe("1.2.0");
  });

  it("keeps an archived version as the newest after a rollback", () => {
    const state = resolveVersions([version("0.1.0", "published"), version("0.1.1", "archived")]);
    expect(state.base?.semver).toBe("0.1.0");
    expect(state.newest?.semver).toBe("0.1.1");
  });

  it("orders numerically and copes with no versions", () => {
    const state = resolveVersions([version("1.9.0", "archived"), version("1.10.0", "archived")]);
    expect(state.ordered.map((v) => v.semver)).toEqual(["1.10.0", "1.9.0"]);
    expect(resolveVersions(undefined).base).toBeUndefined();
  });
});
