/**
 * Platform-agent model IDs, shared by the agent (`skillist-agent.ts`) and the
 * agent-health check so a health probe reports the SAME model the agent runs.
 */

/**
 * Primary model. Chosen over GLM-5.2 in a side-by-side run of real governance
 * tasks: both chained tools correctly, but this one kept "no data" apart from
 * "healthy", which the agent has to do to be trusted on governance questions.
 */
export const AGENT_MODEL_ID = "@cf/deepseek-ai/deepseek-v4-flash-0731";

/** Takes over a turn when the primary fails to start. */
export const AGENT_FALLBACK_MODEL_ID = "@cf/zai-org/glm-5.2";
