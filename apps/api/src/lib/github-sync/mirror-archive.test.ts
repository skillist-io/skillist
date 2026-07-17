import { describe, expect, it } from "vitest";

describe("archiveRemovedMirrorSkills", () => {
  it("computes slugs to archive from discovery set", () => {
    const discovered = new Set(["agents-sdk", "wrangler"]);
    const mirrored = ["agents-sdk", "removed-skill", "wrangler"];
    const toArchive = mirrored.filter((repo) => !discovered.has(repo));
    expect(toArchive).toEqual(["removed-skill"]);
  });
});
