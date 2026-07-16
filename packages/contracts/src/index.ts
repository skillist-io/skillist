import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const skillVisibilitySchema = z.enum(["private", "org", "public"]);
export type SkillVisibility = z.infer<typeof skillVisibilitySchema>;

export const versionStatusSchema = z.enum(["draft", "published", "archived"]);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const feedbackSourceSchema = z.enum(["human", "agent"]);
export type FeedbackSource = z.infer<typeof feedbackSourceSchema>;

export const feedbackStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const aiJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
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
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  visibility: skillVisibilitySchema.default("private"),
  description: z.string().min(1).max(1024).optional(),
});

export const uploadVersionSchema = z.object({
  files: z.record(z.string(), z.string()),
  semver: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
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

export const registryQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "quality",
      "impact",
      "installs",
      "activations",
      "stars",
      "trending",
      "recent",
      "name",
    ])
    .default("quality"),
  runtime: z.enum(["all", "local", "sandbox", "container"]).default("all"),
  minQuality: z.coerce.number().int().min(0).max(100).optional(),
  security: z.enum(["all", "pass", "advisory", "fail"]).default("all"),
  category: z.string().max(64).optional(),
  tag: z.string().max(64).optional(),
});

export const skillMetaSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  etag: z.string().optional(),
  org: z.string(),
  slug: z.string(),
});

export const skillPublishedEventSchema = z.object({
  type: z.literal("skill.published"),
  org: z.string(),
  slug: z.string(),
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

export const executionPolicySchema = z.object({
  hourlyRunLimit: z.number().int().min(1).max(10_000).optional(),
  dailyRunLimit: z.number().int().min(1).max(100_000).optional(),
  containerHourlyLimit: z.number().int().min(1).max(1_000).optional(),
  anonymousHourlyLimit: z.number().int().min(0).max(1_000).optional(),
});
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type PublishPolicy = z.infer<typeof publishPolicySchema>;

export const telemetryEventSchema = z.object({
  orgSlug: z.string(),
  skillSlug: z.string(),
  eventType: z.enum(["install", "activation"]),
  projectHash: z.string().max(64).optional(),
});

export const requiredSkillSchema = z.object({
  orgSlug: z.string(),
  skillSlug: z.string(),
});

export const inventoryScanSchema = z.object({
  items: z.array(
    z.object({
      repoFullName: z.string(),
      filePath: z.string(),
      skillSlug: z.string().optional(),
      registryOrgSlug: z.string().optional(),
      registrySkillSlug: z.string().optional(),
    }),
  ),
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
});

export const runSkillSchema = z.object({
  scriptPath: z
    .string()
    .regex(/^scripts\//, "scriptPath must be under scripts/"),
  args: z.array(z.string().max(512)).max(20).optional(),
  targetUrl: z.string().url().max(2048).optional(),
  stream: z.boolean().optional(),
});
