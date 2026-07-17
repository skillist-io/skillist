import type { Ai, DurableObjectNamespace, Hyperdrive, SendEmail } from "@cloudflare/workers-types";
import type { SyncQueueMessage } from "@skillist/contracts";

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
  SYNC_QUEUE: Queue<SyncQueueMessage>;
  SYNC_WORKFLOW: Workflow;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SSO_PROVIDER_ID?: string;
  SSO_CLIENT_ID?: string;
  SSO_CLIENT_SECRET?: string;
  SSO_DISCOVERY_URL?: string;
  SSO_AUTHORIZATION_URL?: string;
  SSO_TOKEN_URL?: string;
  SSO_USERINFO_URL?: string;
  SSO_SCOPES?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  /** Comma-separated Better Auth user IDs allowed to manage mirrors. */
  SKILLIST_ADMIN_USER_IDS?: string;
};

export type AiJobMessage =
  | {
      type: "feedback";
      jobId: string;
      feedbackId: string;
      skillId: string;
      orgSlug: string;
      skillRepo: string;
    }
  | {
      type: "eval";
      evalId: string;
      skillId: string;
      versionId: string;
      orgSlug: string;
      skillRepo: string;
    };

export type { SkillRealtimeHub } from "./durable-objects/skill-realtime-hub";
export type { SyncQueueMessage };
