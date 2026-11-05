import { describe, expect, it } from "vitest";
import { AGENT_MODEL_ID } from "../../agent/model-config";
import type { Env } from "../../env";
import { checkAgentModel } from "./model-health";

describe("checkAgentModel", () => {
  it("reports the model the agent runs when the binding is present", () => {
    const health = checkAgentModel({ AI: {} } as unknown as Env);
    expect(health).toMatchObject({ provider: "workers-ai", model: AGENT_MODEL_ID, ok: true });
    expect(health.error).toBeNull();
  });

  it("flags a missing binding", () => {
    const health = checkAgentModel({} as unknown as Env);
    expect(health).toMatchObject({ configured: false, ok: false });
    expect(health.error).toBe("The AI binding is missing");
  });
});
