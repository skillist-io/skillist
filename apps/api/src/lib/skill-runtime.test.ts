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
  it("rejects private and reserved IPv4 ranges", () => {
    for (const url of [
      "http://10.0.0.1",
      "http://192.168.1.1",
      "http://172.16.0.1",
      "http://172.20.10.5", // mid 172.16/12 — the old startsWith('172.16.') missed this
      "http://172.31.255.255",
      "http://169.254.169.254", // cloud metadata endpoint
      "http://100.64.0.1", // CGNAT
      "http://0.0.0.0",
    ]) {
      expect(() => validateTargetUrl(url), url).toThrow();
    }
  });
  it("rejects decimal-encoded loopback (URL canonicalizes it to 127.0.0.1)", () => {
    expect(() => validateTargetUrl("http://2130706433")).toThrow();
  });
  it("rejects IPv6 loopback, link-local, and unique-local", () => {
    expect(() => validateTargetUrl("http://[::1]")).toThrow();
    expect(() => validateTargetUrl("http://[fe80::1]")).toThrow();
    expect(() => validateTargetUrl("http://[fc00::1]")).toThrow();
  });
  it("allows a public IPv4 literal", () => {
    expect(validateTargetUrl("https://93.184.216.34")).toBe("https://93.184.216.34/");
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
