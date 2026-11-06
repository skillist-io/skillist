import { describe, expect, it } from "vitest";
import { composerReadout } from "./composer-readout";

const idle = {
  connState: "connected",
  terminal: false,
  busy: false,
  held: false,
  text: "",
} as const;

describe("composerReadout", () => {
  it("teaches the keys when idle", () => {
    expect(composerReadout(idle)).toBe("Enter send · Shift+Enter new line");
  });

  it("says how to stop during a reply", () => {
    expect(composerReadout({ ...idle, busy: true })).toBe("Replying · Esc to stop");
  });

  it("says when Enter was held rather than ignoring it", () => {
    expect(composerReadout({ ...idle, busy: true, held: true })).toBe(
      "Not sent · send again when the reply ends · Esc to stop",
    );
  });

  it("invites typing through a reconnect", () => {
    expect(composerReadout({ ...idle, connState: "disconnected" })).toBe(
      "Reconnecting · keep typing",
    );
  });

  it("reassures about the draft when the connection is gone for good", () => {
    expect(composerReadout({ ...idle, connState: "disconnected", terminal: true })).toBe(
      "Disconnected · your draft is kept",
    );
  });

  it("measures a long paste, and stays quiet for ordinary text", () => {
    expect(composerReadout({ ...idle, text: "short question" })).toBe(
      "Enter send · Shift+Enter new line",
    );
    expect(composerReadout({ ...idle, text: "x\n".repeat(299) })).toBe(
      "300 lines · 598 chars · Enter send · Shift+Enter new line",
    );
    expect(composerReadout({ ...idle, text: "x".repeat(37_000) })).toBe(
      "1 line · 37k chars · Enter send · Shift+Enter new line",
    );
  });

  it("doesn't offer a Shift key to a touch keyboard", () => {
    expect(composerReadout({ ...idle, touch: true })).toBe("Return sends");
  });
});
