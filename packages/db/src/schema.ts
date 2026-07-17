import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgRoleEnum = pgEnum("org_role", ["owner", "editor", "publisher", "viewer"]);
export const skillVisibilityEnum = pgEnum("skill_visibility", ["private", "org", "public"]);
export const versionStatusEnum = pgEnum("version_status", ["draft", "published", "archived"]);
export const feedbackSourceEnum = pgEnum("feedback_source", ["human", "agent"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["pending", "approved", "rejected"]);
export const aiJobStatusEnum = pgEnum("ai_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);
export const securityStatusEnum = pgEnum("security_status", ["pass", "advisory", "fail"]);
export const telemetryEventEnum = pgEnum("telemetry_event", ["install", "activation"]);
export const evalStatusEnum = pgEnum("eval_status", ["queued", "running", "completed", "failed"]);
export const skillRuntimeEnum = pgEnum("skill_runtime", ["local", "sandbox", "container"]);
export const skillRunStatusEnum = pgEnum("skill_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);
export const skillSourceTypeEnum = pgEnum("skill_source_type", ["native", "mirror"]);
export const skillTrustTierEnum = pgEnum("skill_trust_tier", ["official_mirror"]);
export const skillSyncStatusEnum = pgEnum("skill_sync_status", [
  "idle",
  "running",
  "success",
  "failed",
]);
export const skillSourceSuggestionStatusEnum = pgEnum("skill_source_suggestion_status", [
  "pending",
  "approved",
  "rejected",
]);

// Better Auth tables
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    publishPolicy: jsonb("publish_policy").$type<{
      minQualityScore?: number;
      requireSecurityPass?: boolean;
      blockOnAdvisory?: boolean;
      minEvalUplift?: number;
      requireEval?: boolean;
    }>(),
    installPolicy: jsonb("install_policy").$type<{
      warnSeverity?: "low" | "medium" | "high" | "critical";
      blockSeverity?: "low" | "medium" | "high" | "critical";
      allowedSources?: "registry_org_only" | "registry_any" | "registry_plus_git";
      gitAllowlist?: string[];
      minReleaseAgeDays?: number;
    }>(),
    reviewRubric: jsonb("review_rubric").$type<{
      validationWeight?: number;
      checks?: { id: string; weight: number; enabled?: boolean }[];
      llmJudges?: {
        id: string;
        weight: number;
        prompt: string;
        evaluationTarget?: string;
      }[];
    }>(),
    executionPolicy: jsonb("execution_policy").$type<{
      hourlyRunLimit?: number;
      dailyRunLimit?: number;
      containerHourlyLimit?: number;
      anonymousHourlyLimit?: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_members_org_user_idx").on(t.orgId, t.userId),
    index("org_members_user_idx").on(t.userId),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    visibility: skillVisibilityEnum("visibility").notNull().default("private"),
    description: text("description"),
    runtime: skillRuntimeEnum("runtime").notNull().default("local"),
    latestPublishedVersionId: uuid("latest_published_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("skills_org_repo_idx").on(t.orgId, t.repo),
    index("skills_visibility_idx").on(t.visibility),
  ],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    status: versionStatusEnum("status").notNull().default("draft"),
    semver: text("semver").notNull(),
    r2Prefix: text("r2_prefix").notNull(),
    kvEtag: text("kv_etag"),
    qualityScore: integer("quality_score"),
    impactScore: integer("impact_score"),
    securityStatus: securityStatusEnum("security_status"),
    securityIssues:
      jsonb("security_issues").$type<{ severity: string; path: string; message: string }[]>(),
    reviewChecks:
      jsonb("review_checks").$type<
        { id: string; label: string; passed: boolean; message: string }[]
      >(),
    pluginManifest: jsonb("plugin_manifest"),
    parentVersionId: uuid("parent_version_id"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("skill_versions_skill_idx").on(t.skillId),
    index("skill_versions_status_idx").on(t.status),
  ],
);

export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("skill_files_version_path_idx").on(t.versionId, t.path)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    targetVersionId: uuid("target_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    source: feedbackSourceEnum("source").notNull(),
    body: text("body").notNull(),
    suggestedPatch: text("suggested_patch"),
    status: feedbackStatusEnum("status").notNull().default("pending"),
    submittedBy: text("submitted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    apiKeyId: uuid("api_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_skill_idx").on(t.skillId), index("feedback_status_idx").on(t.status)],
);

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  feedbackId: uuid("feedback_id")
    .notNull()
    .references(() => feedback.id, { onDelete: "cascade" }),
  approvedBy: text("approved_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const registryEntries = pgTable(
  "registry_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" })
      .unique(),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    latestVersion: text("latest_version"),
    qualityScore: integer("quality_score"),
    impactScore: integer("impact_score"),
    securityStatus: securityStatusEnum("security_status"),
    installCount: integer("install_count").notNull().default(0),
    activationCount: integer("activation_count").notNull().default(0),
    stars: integer("stars").notNull().default(0),
    category: text("category"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    compatibleAgents: jsonb("compatible_agents").$type<string[]>().notNull().default([]),
    sourceType: skillSourceTypeEnum("source_type").notNull().default("native"),
    upstreamRepo: text("upstream_repo"),
    upstreamUrl: text("upstream_url"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("registry_org_skill_idx").on(t.orgSlug, t.skillRepo),
    index("registry_search_idx").on(t.name, t.description),
    index("registry_category_idx").on(t.category),
    index("registry_source_type_idx").on(t.sourceType),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subscriptions_user_skill_idx").on(t.userId, t.skillId)],
);

export const registryStars = pgTable(
  "registry_stars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("registry_stars_user_skill_idx").on(t.userId, t.skillId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_org_idx").on(t.orgId)],
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    status: aiJobStatusEnum("status").notNull().default("queued"),
    model: text("model"),
    gatewayId: text("gateway_id"),
    resultDraftVersionId: uuid("result_draft_version_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("ai_jobs_feedback_idx").on(t.feedbackId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_org_idx").on(t.orgId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    eventType: telemetryEventEnum("event_type").notNull(),
    projectHash: text("project_hash"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("telemetry_skill_idx").on(t.orgSlug, t.skillRepo),
    index("telemetry_type_idx").on(t.eventType),
  ],
);

export const skillEvals = pgTable(
  "skill_evals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    status: evalStatusEnum("status").notNull().default("queued"),
    scenarios: jsonb("scenarios").$type<{ name: string; prompt: string }[]>(),
    baselineScore: integer("baseline_score"),
    withSkillScore: integer("with_skill_score"),
    uplift: integer("uplift"),
    results:
      jsonb("results").$type<
        {
          name: string;
          prompt: string;
          baselineScore: number;
          withSkillScore: number;
          uplift: number;
        }[]
      >(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("skill_evals_skill_idx").on(t.skillId)],
);

export const orgRequiredSkills = pgTable(
  "org_required_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_required_skills_idx").on(t.orgId, t.orgSlug, t.skillRepo)],
);

export const skillInventory = pgTable(
  "skill_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repoFullName: text("repo_full_name").notNull(),
    filePath: text("file_path").notNull(),
    localSlug: text("local_slug"),
    managed: boolean("managed").notNull().default(false),
    registryOrgSlug: text("registry_org_slug"),
    registryRepo: text("registry_repo"),
    sourceType: text("source_type"),
    scope: text("scope"),
    marketplace: text("marketplace"),
    pluginName: text("plugin_name"),
    isSymlink: boolean("is_symlink").notNull().default(false),
    conformanceStatus: text("conformance_status"),
    conformanceIssues:
      jsonb("conformance_issues").$type<{ level: string; field?: string; message: string }[]>(),
    contentHash: text("content_hash"),
    securityStatus: securityStatusEnum("security_status"),
    securityIssues:
      jsonb("security_issues").$type<{ severity: string; path: string; message: string }[]>(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("skill_inventory_repo_path_idx").on(t.orgId, t.repoFullName, t.filePath)],
);

export const orgMcpServers = pgTable(
  "org_mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    upstreamUrl: text("upstream_url").notNull(),
    transport: text("transport").notNull().default("http"),
    oauthClientId: text("oauth_client_id"),
    oauthClientSecret: text("oauth_client_secret"),
    oauthScope: text("oauth_scope"),
    oauthResourceUrl: text("oauth_resource_url"),
    oauthAuthorizationServerUrl: text("oauth_authorization_server_url"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    status: text("status").notNull().default("unauthorized"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_mcp_servers_org_name_idx").on(t.orgId, t.name)],
);

export const skillRuns = pgTable(
  "skill_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    scriptPath: text("script_path").notNull(),
    runtime: skillRuntimeEnum("runtime").notNull(),
    status: skillRunStatusEnum("status").notNull().default("queued"),
    args: jsonb("args").$type<string[]>(),
    targetUrl: text("target_url"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    actorId: text("actor_id"),
    actorType: text("actor_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("skill_runs_skill_idx").on(t.skillId),
    index("skill_runs_created_idx").on(t.createdAt),
  ],
);

export const skillSources = pgTable(
  "skill_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    discoveryRoots: jsonb("discovery_roots").$type<string[]>().notNull().default(["skills"]),
    trustTier: skillTrustTierEnum("trust_tier").notNull().default("official_mirror"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastCommitSha: text("last_commit_sha"),
    lastSyncStatus: skillSyncStatusEnum("last_sync_status").notNull().default("idle"),
    lastSyncError: text("last_sync_error"),
    pendingCommitSha: text("pending_commit_sha"),
    pendingPublishCount: integer("pending_publish_count").notNull().default(0),
    license: text("license"),
    homepageUrl: text("homepage_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("skill_sources_owner_repo_idx").on(t.githubOwner, t.githubRepo),
    index("skill_sources_sync_enabled_idx").on(t.syncEnabled),
  ],
);

export const skillSourceSuggestions = pgTable(
  "skill_source_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    discoveredVia: text("discovered_via").notNull(),
    stars: integer("stars").notNull().default(0),
    license: text("license"),
    matchScore: integer("match_score").notNull().default(0),
    status: skillSourceSuggestionStatusEnum("status").notNull().default("pending"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("skill_source_suggestions_owner_repo_idx").on(t.githubOwner, t.githubRepo),
    index("skill_source_suggestions_status_idx").on(t.status),
  ],
);

export const skillProvenance = pgTable(
  "skill_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" })
      .unique(),
    sourceId: uuid("source_id").references(() => skillSources.id, { onDelete: "set null" }),
    sourcePath: text("source_path").notNull(),
    sourceCommitSha: text("source_commit_sha"),
    sourceUrl: text("source_url"),
    contentHash: text("content_hash").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("skill_provenance_source_idx").on(t.sourceId)],
);

// Better Auth MCP / OIDC provider tables
export const oauthApplications = pgTable(
  "oauth_application",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    metadata: text("metadata"),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_urls").notNull(),
    type: text("type").notNull(),
    disabled: boolean("disabled").notNull().default(false),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_application_user_idx").on(t.userId)],
);

export const oauthAccessTokens = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").notNull().unique(),
    refreshToken: text("refresh_token").notNull().unique(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_user_idx").on(t.userId),
  ],
);

export const oauthConsents = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    consentGiven: boolean("consent_given").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
    uniqueIndex("oauth_consent_user_client_idx").on(t.userId, t.clientId),
  ],
);
