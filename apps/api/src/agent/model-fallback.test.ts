import { describe, expect, it, vi } from "vitest";
import { withFallback } from "./model-fallback";

describe("withFallback", () => {
  it("returns the primary result and never calls the fallback on success", async () => {
    const fallback = vi.fn(async () => "fallback");
    const result = await withFallback("stream", async () => "primary", fallback);
    expect(result).toBe("primary");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("re-dispatches to the fallback when the primary throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await withFallback(
      "stream",
      async () => {
        throw new Error("auth error");
      },
      async () => "fallback",
    );
    expect(result).toBe("fallback");
    // The failure is logged for observability.
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("handles a synchronous throw from the primary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await withFallback(
      "generate",
      () => {
        throw new Error("boom");
      },
      () => "recovered",
    );
    expect(result).toBe("recovered");
    vi.restoreAllMocks();
  });

  it("propagates the error if the fallback also throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withFallback(
        "stream",
        () => {
          throw new Error("primary");
        },
        () => {
          throw new Error("fallback too");
        },
      ),
    ).rejects.toThrow("fallback too");
    vi.restoreAllMocks();
  });
});
