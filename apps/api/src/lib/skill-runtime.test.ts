import { createSkillTemplate, objectToBundle } from "@skillist/skill-format";
import { describe, expect, it } from "vitest";
import {
  buildExecCommand,
  detectSkillRuntime,
  listRunnableScripts,
  validateScriptPath,
  validateTargetUrl,
} from "./skill-runtime";

describe("validateScriptPath", () => {
  it("allows scripts under scripts/", () => {
    expect(validateScriptPath("scripts/collect-metrics.sh")).toBe(true);
  });
  it("rejects traversal", () => {
    expect(validateScriptPath("scripts/../SKILL.md")).toBe(false);
  });
});

describe("detectSkillRuntime", () => {
  it("returns local without scripts", () => {
    const bundle = createSkillTemplate("x", "desc");
    expect(detectSkillRuntime(bundle)).toBe("local");
  });

  it("returns sandbox for script bundles", () => {
    const bundle = objectToBundle({
      "SKILL.md": `---\nname: web-perf\ndescription: Audit web performance with scripts and references for Core Web Vitals.\n---\n# Perf`,
      "scripts/run.sh": "#!/bin/bash\necho ok",
    });
    expect(detectSkillRuntime(bundle)).toBe("sandbox");
  });
});

describe("buildExecCommand", () => {
  it("wraps shell scripts with bash", () => {
    expect(buildExecCommand("scripts/a.sh", ["https://example.com"])).toContain("bash");
  });
});

describe("validateTargetUrl", () => {
  it("rejects localhost", () => {
    expect(() => validateTargetUrl("http://localhost:3000")).toThrow();
  });
  it("allows public https", () => {
    expect(validateTargetUrl("https://example.com")).toBe("https://example.com/");
  });
});

describe("listRunnableScripts", () => {
  it("lists script files only", () => {
    const bundle = objectToBundle({
      "scripts/a.sh": "",
      "references/b.md": "",
    });
    expect(listRunnableScripts(bundle)).toEqual(["scripts/a.sh"]);
  });
});
