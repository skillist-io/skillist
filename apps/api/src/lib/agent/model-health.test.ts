import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../env";
import { checkAgentModel } from "./model-health";

const env = (key?: string) => ({ ANTHROPIC_API_KEY: key }) as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkAgentModel", () => {
  it("reports the Workers AI path (healthy, no external auth) when no key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const health = await checkAgentModel(env(undefined));
    expect(health).toMatchObject({ provider: "workers-ai", configured: false, ok: true });
    // No key → never touches Anthropic.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports ok when the key authenticates (200)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const health = await checkAgentModel(env("sk-ant-valid"));
    expect(health).toMatchObject({
      provider: "anthropic",
      configured: true,
      ok: true,
      status: 200,
    });
    expect(health.error).toBeNull();
  });

  it("flags a bad key (401) with the provider's message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "API key is invalid." } }), { status: 401 }),
    );
    const health = await checkAgentModel(env("sk-ant-bad"));
    expect(health).toMatchObject({ ok: false, status: 401, error: "API key is invalid." });
  });

  it("flags a missing model (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    const health = await checkAgentModel(env("sk-ant-valid"));
    expect(health).toMatchObject({ ok: false, status: 404 });
  });

  it("treats a network throw as unhealthy rather than propagating", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const health = await checkAgentModel(env("sk-ant-valid"));
    expect(health).toMatchObject({ ok: false, status: null, error: "network down" });
  });
});
