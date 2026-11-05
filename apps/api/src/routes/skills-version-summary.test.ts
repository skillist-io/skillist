import { skills, skillVersions } from "@skillist/db/schema";
import { describe, expect, it } from "vitest";
import { cleanup, seedOrg, seedUser, withDb } from "../test-support/db";
import { loadOrgVersions, summarizeVersions } from "./skills";

const row = (status: string, semver: string, skillId = "a") => ({ skillId, status, semver });

describe("summarizeVersions", () => {
  it("reports a draft newer than what is live", () => {
    expect(summarizeVersions([row("published", "1.0.0"), row("draft", "1.1.0")], "a")).toEqual({
      publishedSemver: "1.0.0",
      draftSemver: "1.1.0",
    });
  });

  it("ignores a draft left behind by a later publish", () => {
    expect(summarizeVersions([row("published", "1.2.0"), row("draft", "1.1.0")], "a")).toEqual({
      publishedSemver: "1.2.0",
      draftSemver: null,
    });
  });

  it("compares numerically, not as text", () => {
    const versions = [row("published", "1.9.0"), row("published", "1.10.0")];
    expect(summarizeVersions(versions, "a").publishedSemver).toBe("1.10.0");
  });

  it("counts an unpublished skill's draft and keeps skills apart", () => {
    const versions = [row("draft", "0.1.0"), row("published", "2.0.0", "b")];
    expect(summarizeVersions(versions, "a")).toEqual({
      publishedSemver: null,
      draftSemver: "0.1.0",
    });
  });
});

describe("loadOrgVersions", () => {
  it("reads one org's live and draft versions from D1", async () => {
    await withDb(async (db) => {
      const user = await seedUser(db);
      const org = await seedOrg(db, user.id);
      const otherOrg = await seedOrg(db, user.id);
      try {
        const addSkill = async (orgId: string, repo: string) => {
          const [skill] = await db
            .insert(skills)
            .values({ orgId, repo, visibility: "private" })
            .returning({ id: skills.id });
          return skill!.id;
        };
        const addVersion = (
          skillId: string,
          status: "draft" | "published" | "archived",
          semver: string,
        ) =>
          db.insert(skillVersions).values({ skillId, status, semver, r2Prefix: `test/${semver}` });

        const mine = await addSkill(org.id, "mine");
        await addVersion(mine, "archived", "0.9.0");
        await addVersion(mine, "published", "1.0.0");
        await addVersion(mine, "draft", "1.1.0");
        const theirs = await addSkill(otherOrg.id, "theirs");
        await addVersion(theirs, "published", "9.0.0");

        const versions = await loadOrgVersions(db, org.id);

        // The archived row and the other org's skill must both stay out.
        expect(versions.map((v) => v.semver).sort()).toEqual(["1.0.0", "1.1.0"]);
        expect(summarizeVersions(versions, mine)).toEqual({
          publishedSemver: "1.0.0",
          draftSemver: "1.1.0",
        });
      } finally {
        await cleanup(db, { orgs: [org.id, otherOrg.id], users: [user.id] });
      }
    });
  });
});
