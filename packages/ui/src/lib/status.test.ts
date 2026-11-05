import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissStatus, getStatusMessages, notify } from "./status";

describe("status store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const message of getStatusMessages()) dismissStatus(message.id);
    vi.useRealTimers();
  });

  it("clears successes on its own", () => {
    notify("success", "Policy saved");
    expect(getStatusMessages().map((m) => m.text)).toEqual(["Policy saved"]);
    vi.advanceTimersByTime(6000);
    expect(getStatusMessages()).toEqual([]);
  });

  it("keeps errors until they are dismissed", () => {
    notify("error", "Could not publish");
    vi.advanceTimersByTime(60_000);
    expect(getStatusMessages()).toHaveLength(1);
    dismissStatus(getStatusMessages()[0]!.id);
    expect(getStatusMessages()).toEqual([]);
  });

  it("does not stack an identical message", () => {
    notify("error", "Could not publish");
    notify("error", "Could not publish");
    expect(getStatusMessages()).toHaveLength(1);
  });
});
