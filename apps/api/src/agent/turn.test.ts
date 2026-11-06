import { describe, expect, it } from "vitest";
import { titleFromMessage, waitingOnPerson } from "./turn";

const stopsOn = (output: unknown) =>
  waitingOnPerson({ steps: [{ toolResults: [{ output }] }] } as never);

describe("waitingOnPerson", () => {
  it("stops on a gated call and on nothing else", async () => {
    expect(await stopsOn({ ok: false, status: "awaiting_approval", approvalId: "a" })).toBe(true);
    expect(await stopsOn({ ok: false, status: "denied" })).toBe(false);
    expect(await stopsOn({ ok: true })).toBe(false);
    expect(await stopsOn("awaiting_approval")).toBe(false);
  });

  it("only reads the latest step", async () => {
    const steps = [
      { toolResults: [{ output: { status: "awaiting_approval" } }] },
      { toolResults: [] },
    ];
    expect(await waitingOnPerson({ steps } as never)).toBe(false);
  });
});

describe("titleFromMessage", () => {
  it("drops the context line", () => {
    expect(titleFromMessage("[context] page: Coverage\nWhat is drifting?")).toBe(
      "What is drifting?",
    );
  });

  it("has nothing to say about a message that is only an approval", () => {
    expect(titleFromMessage("[approval] id: abc")).toBeNull();
    expect(titleFromMessage("[approval] id: abc\nApproved. Run it.")).toBeNull();
  });

  it("cuts a long message and says so", () => {
    const title = titleFromMessage("word ".repeat(40));
    expect(title?.length).toBeLessThanOrEqual(61);
    expect(title?.endsWith("…")).toBe(true);
  });
});
