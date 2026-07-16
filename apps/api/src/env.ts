import type { Ai, DurableObjectNamespace, SendEmail } from "@cloudflare/workers-types";
import type { Hyperdrive } from "@cloudflare/workers-types";

export type Env = {
  HYPERDRIVE: Hyperdrive;
  SKILLS_KV: KVNamespace;
  SKILLS_R2: R2Bucket;
  SKILL_HUB: DurableObjectNamespace;
  SANDBOX: DurableObjectNamespace;
  SANDBOX_HEAVY: DurableObjectNamespace;
  AI: Ai;
  EMAIL: SendEmail;
  AI_QUEUE: Queue<AiJobMessage>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_TOKEN?: string;
};

export type AiJobMessage =
  | {
      type: "feedback";
      jobId: string;
      feedbackId: string;
      skillId: string;
      orgSlug: string;
      skillSlug: string;
    }
  | {
      type: "eval";
      evalId: string;
      skillId: string;
      versionId: string;
      orgSlug: string;
      skillSlug: string;
    };

export type { SkillRealtimeHub } from "./durable-objects/skill-realtime-hub";
