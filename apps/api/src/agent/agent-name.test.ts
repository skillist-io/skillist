import { describe, expect, it } from "vitest";
import {
  composeAgentName,
  parseAgentName,
  parseClientInstance,
  shouldGenerateTitle,
} from "./agent-name";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "user_abc123";
const CHAT = "22222222-2222-2222-2222-222222222222";

describe("composeAgentName / parseAgentName", () => {
  it("round-trips the canonical orgId::userId::chatId form", () => {
    const name = composeAgentName(ORG, USER, CHAT);
    expect(name).toBe(`${ORG}::${USER}::${CHAT}`);
    expect(parseAgentName(name)).toEqual({ orgId: ORG, userId: USER, chatId: CHAT });
  });

  it("parses the two-part client form (no userId) so orgId is still recoverable", () => {
    expect(parseAgentName(`${ORG}::${CHAT}`)).toEqual({
      orgId: ORG,
      userId: null,
      chatId: CHAT,
    });
  });

  it("parses a bare orgId", () => {
    expect(parseAgentName(ORG)).toEqual({ orgId: ORG, userId: null, chatId: null });
  });

  it("tolerates null / empty names", () => {
    expect(parseAgentName(null)).toEqual({ orgId: "", userId: null, chatId: null });
    expect(parseAgentName(undefined)).toEqual({ orgId: "", userId: null, chatId: null });
    expect(parseAgentName("")).toEqual({ orgId: "", userId: null, chatId: null });
  });
});

describe("parseClientInstance", () => {
  it("splits orgId::chatId on the FIRST separator (orgId can't absorb chatId)", () => {
    expect(parseClientInstance(`${ORG}::${CHAT}`)).toEqual({ orgId: ORG, chatId: CHAT });
  });

  it("returns a null chatId for a bare orgId", () => {
    expect(parseClientInstance(ORG)).toEqual({ orgId: ORG, chatId: null });
  });
});

describe("shouldGenerateTitle", () => {
  it("fires on the first user turn when no title exists", () => {
    expect(shouldGenerateTitle(1, false)).toBe(true);
    expect(shouldGenerateTitle(0, false)).toBe(true);
  });

  it("does not fire once a title exists", () => {
    expect(shouldGenerateTitle(1, true)).toBe(false);
  });

  it("does not fire on later turns", () => {
    expect(shouldGenerateTitle(2, false)).toBe(false);
  });
});
