import { describe, expect, it } from "vitest";
import { evaluateInstallPolicy, securityStatusToSeverity } from "./install-policy";

describe("evaluateInstallPolicy", () => {
  it("allows clean registry installs by default", () => {
    const result = evaluateInstallPolicy(
      {},
      {
        skillOrgSlug: "acme",
        policyOrgSlug: "acme",
        source: "registry",
        securityStatus: "pass",
      },
    );
    expect(result.decision).toBe("allow");
    expect(result.allowed).toBe(true);
  });

  it("blocks when severity meets block threshold", () => {
    const result = evaluateInstallPolicy(
      { blockSeverity: "high" },
      {
        skillOrgSlug: "other",
        policyOrgSlug: "acme",
        source: "registry",
        securityStatus: "fail",
      },
    );
    expect(result.decision).toBe("block");
    expect(result.allowed).toBe(false);
  });

  it("warns at warn threshold", () => {
    const result = evaluateInstallPolicy(
      { warnSeverity: "medium", blockSeverity: "high" },
      {
        skillOrgSlug: "acme",
        policyOrgSlug: "acme",
        source: "registry",
        securityStatus: "advisory",
      },
    );
    expect(result.decision).toBe("warn");
    expect(result.allowed).toBe(true);
  });

  it("blocks git when registry_any", () => {
    const result = evaluateInstallPolicy(
      { allowedSources: "registry_any" },
      {
        skillOrgSlug: "acme",
        policyOrgSlug: "acme",
        source: "git",
        gitHost: "github.com/acme",
      },
    );
    expect(result.decision).toBe("block");
  });

  it("enforces registry_org_only", () => {
    const result = evaluateInstallPolicy(
      { allowedSources: "registry_org_only" },
      {
        skillOrgSlug: "other",
        policyOrgSlug: "acme",
        source: "registry",
        securityStatus: "pass",
      },
    );
    expect(result.decision).toBe("block");
  });

  it("maps status to severity", () => {
    expect(securityStatusToSeverity("pass")).toBe("low");
    expect(securityStatusToSeverity("advisory")).toBe("medium");
    expect(securityStatusToSeverity("fail")).toBe("high");
  });
});
