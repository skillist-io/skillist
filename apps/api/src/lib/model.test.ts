import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { AI_GATEWAY_ID, MODEL, runModel } from "./model";

const envWith = (run: unknown) => ({ AI: { run } }) as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runModel", () => {
  it("routes through the gateway", async () => {
    const run = vi.fn().mockResolvedValue({ response: "hello" });
    await expect(runModel(envWith(run), "hi")).resolves.toBe("hello");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(MODEL);
    expect(run.mock.calls[0]?.[2]).toMatchObject({ gateway: { id: AI_GATEWAY_ID } });
  });

  it("retries on the binding directly when the gateway fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce({ response: "direct" });
    await expect(runModel(envWith(run), "hi")).resolves.toBe("direct");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[2]).toBeUndefined();
  });

  it("lets a failure on both paths reach the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("model down"));
    await expect(runModel(envWith(run), "hi")).rejects.toThrow("model down");
  });

  it("treats a response with no text as empty", async () => {
    const run = vi.fn().mockResolvedValue({});
    await expect(runModel(envWith(run), "hi")).resolves.toBe("");
  });
});
