import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "editor", "publisher", "viewer"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const securitySeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type SecuritySeverity = z.infer<typeof securitySeveritySchema>;

export const skillVisibilitySchema = z.enum(["private", "org", "public"]);
export type SkillVisibility = z.infer<typeof skillVisibilitySchema>;

export const versionStatusSchema = z.enum(["draft", "published", "archived"]);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const feedbackSourceSchema = z.enum(["human", "agent"]);
export type FeedbackSource = z.infer<typeof feedbackSourceSchema>;

export const feedbackStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const aiJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;

export const apiKeyScopeSchema = z.enum([
  "skills:read",
  "skills:write",
  "skills:run",
  "feedback:submit",
  "feedback:approve",
  "skills:publish",
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createOrgSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const createSkillSchema = z.object({
  repo: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  visibility: skillVisibilitySchema.default("private"),
  description: z.string().min(1).max(1024).optional(),
});

export const uploadVersionSchema = z.object({
  files: z.record(z.string(), z.string()),
  semver: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  bump: z.enum(["major", "minor", "patch"]).optional(),
  parentVersionId: z.string().uuid().optional(),
});

export const submitFeedbackSchema = z.object({
  targetVersionId: z.string().uuid(),
  body: z.string().min(1).max(10000),
  suggestedPatch: z.string().optional(),
});

export const approveFeedbackSchema = z.object({
  comment: z.string().max(2000).optional(),
  triggerAi: z.boolean().default(true),
});

export const rejectFeedbackSchema = z.object({
  comment: z.string().max(2000).optional(),
});

export const skillSourceTypeSchema = z.enum(["native", "mirror"]);
export type SkillSourceType = z.infer<typeof skillSourceTypeSchema>;

export const registryQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["quality", "impact", "installs", "activations", "stars", "trending", "recent", "name"])
    .default("quality"),
  runtime: z.enum(["all", "local", "sandbox", "container"]).default("all"),
  minQuality: z.coerce.number().int().min(0).max(100).optional(),
  security: z.enum(["all", "pass", "advisory", "fail"]).default("all"),
  category: z.string().max(64).optional(),
  tag: z.string().max(64).optional(),
  agent: z.string().max(64).optional(),
  /** Filter by origin: native (published on Skillist) or mirror (synced from GitHub). */
  sourceType: z.enum(["all", "native", "mirror"]).default("all"),
});

export const syncQueueMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync_source"), sourceId: z.string().uuid() }),
  z.object({ type: z.literal("sync_all") }),
  z.object({ type: z.literal("discover_sources") }),
  z.object({
    type: z.literal("publish_skill"),
    sourceId: z.string().uuid(),
    skillSlug: z.string().min(1),
    sourcePath: z.string().min(1),
    commitSha: z.string().min(1),
  }),
]);
export type SyncQueueMessage = z.infer<typeof syncQueueMessageSchema>;

export const skillMetaSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  etag: z.string().optional(),
  org: z.string(),
  repo: z.string(),
});

export const skillPublishedEventSchema = z.object({
  type: z.literal("skill.published"),
  org: z.string(),
  repo: z.string(),
  version: z.string(),
  versionId: z.string().uuid(),
  etag: z.string(),
  publishedAt: z.string().datetime(),
  skillMd: z.string().optional(),
});

export type SkillPublishedEvent = z.infer<typeof skillPublishedEventSchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(apiKeyScopeSchema).min(1),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: orgRoleSchema.default("viewer"),
});

export const publishPolicySchema = z.object({
  minQualityScore: z.number().int().min(0).max(100).optional(),
  requireSecurityPass: z.boolean().optional(),
  blockOnAdvisory: z.boolean().optional(),
  minEvalUplift: z.number().int().min(-100).max(100).optional(),
  requireEval: z.boolean().optional(),
});

export const installPolicySchema = z.object({
  warnSeverity: securitySeveritySchema.optional(),
  blockSeverity: securitySeveritySchema.optional(),
  allowedSources: z.enum(["registry_org_only", "registry_any", "registry_plus_git"]).optional(),
  gitAllowlist: z.array(z.string().min(1).max(256)).max(100).optional(),
  minReleaseAgeDays: z.number().int().min(0).max(365).optional(),
});
export type InstallPolicy = z.infer<typeof installPolicySchema>;

export const reviewRubricSchema = z.object({
  validationWeight: z.number().min(0).max(1).optional(),
  checks: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        weight: z.number().min(0).max(100),
        enabled: z.boolean().optional(),
      }),
    )
    .optional(),
  llmJudges: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        weight: z.number().min(0).max(1),
        prompt: z.string().min(1).max(4000),
        evaluationTarget: z.string().max(128).optional(),
      }),
    )
    .max(10)
    .optional(),
});
export type ReviewRubric = z.infer<typeof reviewRubricSchema>;

export const executionPolicySchema = z.object({
  hourlyRunLimit: z.number().int().min(1).max(10_000).optional(),
  dailyRunLimit: z.number().int().min(1).max(100_000).optional(),
  containerHourlyLimit: z.number().int().min(1).max(1_000).optional(),
  anonymousHourlyLimit: z.number().int().min(0).max(1_000).optional(),
});
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type PublishPolicy = z.infer<typeof publishPolicySchema>;

export const installCheckSchema = z.object({
  orgSlug: z.string().min(1),
  skillRepo: z.string().min(1),
  source: z.enum(["registry", "git"]).default("registry"),
  gitHost: z.string().max(256).optional(),
  publishedAt: z.string().datetime().optional(),
});

export const telemetryEventSchema = z.object({
  orgSlug: z.string(),
  skillRepo: z.string(),
  eventType: z.enum(["install", "activation"]),
  projectHash: z.string().max(64).optional(),
});

export const requiredSkillSchema = z.object({
  orgSlug: z.string(),
  skillRepo: z.string(),
});

export const inventoryScanSchema = z.object({
  items: z.array(
    z.object({
      repoFullName: z.string(),
      filePath: z.string(),
      localSlug: z.string().optional(),
      registryOrgSlug: z.string().optional(),
      registryRepo: z.string().optional(),
      sourceType: z.string().optional(),
      scope: z.string().optional(),
      marketplace: z.string().optional(),
      pluginName: z.string().optional(),
      isSymlink: z.boolean().optional(),
      conformanceStatus: z.string().optional(),
      conformanceIssues: z
        .array(
          z.object({
            level: z.string(),
            field: z.string().optional(),
            message: z.string(),
          }),
        )
        .optional(),
      contentHash: z.string().optional(),
      securityStatus: z.enum(["pass", "advisory", "fail"]).optional(),
      securityIssues: z
        .array(
          z.object({
            severity: z.string(),
            path: z.string(),
            message: z.string(),
          }),
        )
        .optional(),
      skillMd: z.string().max(500_000).optional(),
    }),
  ),
});

export const mcpServerSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z0-9_-]+$/),
  upstreamUrl: z.string().url().max(2048),
  transport: z.enum(["http", "sse"]).default("http"),
  oauthClientId: z.string().max(256).optional(),
  oauthClientSecret: z.string().max(512).optional(),
  oauthScope: z.string().max(512).optional(),
  oauthResourceUrl: z.string().url().max(2048).optional(),
  oauthAuthorizationServerUrl: z.string().url().max(2048).optional(),
});

export const runEvalSchema = z.object({
  scenarios: z
    .array(
      z.object({
        name: z.string(),
        prompt: z.string(),
      }),
    )
    .optional(),
  generateScenarios: z.boolean().optional(),
  scenarioCount: z.number().int().min(1).max(10).optional(),
});

export const runSkillSchema = z.object({
  scriptPath: z.string().regex(/^scripts\//, "scriptPath must be under scripts/"),
  args: z.array(z.string().max(512)).max(20).optional(),
  targetUrl: z.string().url().max(2048).optional(),
  stream: z.boolean().optional(),
});
