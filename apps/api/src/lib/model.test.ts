import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import {
  AI_GATEWAY_ID,
  MODEL,
  ModelRateLimitError,
  NO_PAYLOAD_LOGGING,
  rateLimitRetryDelay,
  runModel,
} from "./model";

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

  it("does not spend more of the budget when rate limited", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(new Error("3021: rate limiting: inference request per min rate reached"));
    await expect(runModel(envWith(run), "hi")).rejects.toBeInstanceOf(ModelRateLimitError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("recognises a rate limit on the direct retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockRejectedValueOnce(new Error("AiError: rate limiting"));
    await expect(runModel(envWith(run), "hi")).rejects.toBeInstanceOf(ModelRateLimitError);
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

describe("rateLimitRetryDelay", () => {
  it("waits longer on each attempt", () => {
    const limited = new ModelRateLimitError();
    expect(rateLimitRetryDelay(limited, 1, 3)).toBe(60);
    expect(rateLimitRetryDelay(limited, 3, 3)).toBe(180);
  });

  it("gives up once retries run out, so the job can fail visibly", () => {
    expect(rateLimitRetryDelay(new ModelRateLimitError(), 4, 3)).toBeNull();
  });

  it("leaves other failures alone", () => {
    expect(rateLimitRetryDelay(new Error("model down"), 1, 3)).toBeNull();
  });
});
