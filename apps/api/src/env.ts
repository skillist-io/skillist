import type {
  Ai,
  DurableObjectNamespace,
  Hyperdrive,
  RateLimit,
  SendEmail,
} from "@cloudflare/workers-types";
import type { SyncQueueMessage } from "@skillist/contracts";

export type Env = {
  /**
   * Caching-enabled Hyperdrive (default query cache). Used only for the
   * read-heavy, staleness-tolerant registry browse queries.
   */
  HYPERDRIVE: Hyperdrive;
  /**
   * Caching-DISABLED Hyperdrive over the same database. This is the default
   * client for everything else — auth, permissions, writes, and read-after-write
   * — where a 60s stale read would be wrong (e.g. a revoked API key must stop
   * authenticating immediately). Optional so local dev / tests fall back to the
   * single HYPERDRIVE binding.
   */
  HYPERDRIVE_CACHE_DISABLED?: Hyperdrive;
  SKILLS_KV: KVNamespace;
  SKILLS_R2: R2Bucket;
  SKILL_HUB: DurableObjectNamespace;
  SANDBOX: DurableObjectNamespace;
  SANDBOX_HEAVY: DurableObjectNamespace;
  /** Per-org platform agent (AIChatAgent DO). Instance name = orgId. */
  SKILLIST_AGENT: DurableObjectNamespace;
  AI: Ai;
  EMAIL: SendEmail;
  /** Native Workers Rate Limiting binding (distributed). Optional so local dev
   * and tests without the binding fall back to the in-memory limiter. */
  RATE_LIMITER?: RateLimit;
  AI_QUEUE: Queue<AiJobMessage>;
  SYNC_QUEUE: Queue<SyncQueueMessage>;
  SYNC_WORKFLOW: Workflow;
  /** Durable failure-mining pipeline (recurring run/eval failures → feedback). */
  FAILURE_WORKFLOW: Workflow;
  /** Vectorize index for clustering skill-run/eval failure embeddings. */
  VECTORIZE: VectorizeIndex;
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
