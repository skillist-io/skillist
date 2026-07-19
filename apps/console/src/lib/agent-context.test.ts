import { describe, expect, it } from "vitest";
import { type AgentContext, describeContext, formatContext, splitContext } from "./agent-context";

const base: AgentContext = { page: "Coverage", pathname: "/coverage" };

describe("agent context", () => {
  it("round-trips a message with context attached", () => {
    const sent = `${formatContext(base)}\nWhat is drifting?`;
    expect(splitContext(sent)).toEqual({
      context: "page: Coverage, path: /coverage",
      body: "What is drifting?",
    });
  });

  it("leaves a message without context untouched", () => {
    expect(splitContext("Just a question")).toEqual({
      context: null,
      body: "Just a question",
    });
  });

  it("does not mistake a bracketed message for a context line", () => {
    const text = "[note] this is the user's own bracket";
    expect(splitContext(text)).toEqual({ context: null, body: text });
  });

  it("includes entity ids when the route names them", () => {
    const line = formatContext({
      page: "pdf-tools",
      pathname: "/orgs/acme/skills/pdf-tools",
      orgId: "acme",
      skillRef: "acme/pdf-tools",
    });
    expect(line).toContain("org: acme");
    expect(line).toContain("skill: acme/pdf-tools");
  });

  it("preserves multi-line message bodies", () => {
    const sent = `${formatContext(base)}\nline one\nline two`;
    expect(splitContext(sent).body).toBe("line one\nline two");
  });

  it("survives a context line with no body", () => {
    expect(splitContext(formatContext(base))).toEqual({
      context: "page: Coverage, path: /coverage",
      body: "",
    });
  });

  it("labels the chip with the skill when there is one", () => {
    expect(describeContext(base)).toBe("Coverage");
    expect(describeContext({ ...base, skillRef: "acme/pdf-tools" })).toBe(
      "Coverage · acme/pdf-tools",
    );
  });
});
