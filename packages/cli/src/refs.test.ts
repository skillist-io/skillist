import { describe, expect, it } from "vitest";
import { deliveryRef, parseRef } from "./refs.js";

describe("parseRef", () => {
  it("parses plain refs", () => {
    expect(parseRef("acme/widget")).toEqual({ org: "acme", repo: "widget" });
  });

  it("treats @latest as unpinned", () => {
    expect(parseRef("acme/widget@latest")).toEqual({ org: "acme", repo: "widget" });
  });

  it("parses exact version pins", () => {
    expect(parseRef("acme/widget@1.2.3")).toEqual({
      org: "acme",
      repo: "widget",
      version: "1.2.3",
    });
    expect(parseRef("acme/widget@1.2.3-beta.1")).toEqual({
      org: "acme",
      repo: "widget",
      version: "1.2.3-beta.1",
    });
  });

  it("rejects malformed refs", () => {
    expect(() => parseRef("acme")).toThrow(/Invalid ref/);
    expect(() => parseRef("acme/widget@")).toThrow(/Invalid version/);
    expect(() => parseRef("acme/widget@1.2")).toThrow(/Invalid version/);
    expect(() => parseRef("acme/@1.2.3")).toThrow(/Invalid ref/);
  });
});

describe("deliveryRef", () => {
  it("builds pinned and unpinned path segments", () => {
    expect(deliveryRef({ org: "acme", repo: "widget" })).toBe("acme/widget");
    expect(deliveryRef({ org: "acme", repo: "widget", version: "1.2.3" })).toBe(
      "acme/widget@1.2.3",
    );
  });
});
