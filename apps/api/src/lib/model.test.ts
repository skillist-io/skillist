import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { AI_GATEWAY_ID, MODEL, NO_PAYLOAD_LOGGING, runModel } from "./model";

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
    expect(run.mock.calls[0]?.[2]).toMatchObject({
      gateway: { id: AI_GATEWAY_ID },
      extraHeaders: NO_PAYLOAD_LOGGING,
    });
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

  it("reads OpenAI-style choices", async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: "73" } }] });
    await expect(runModel(envWith(run), "hi")).resolves.toBe("73");
  });

  it("rejects a reply that hit the token limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "# Half a ski" }, finish_reason: "length" }],
    });
    await expect(runModel(envWith(run), "hi")).rejects.toThrow("cut off");
  });

  it("fails rather than returning empty text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: "" } }] });
    await expect(runModel(envWith(run), "hi")).rejects.toThrow("The model returned no text");
  });
});
