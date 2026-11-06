import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Timestamps are epoch milliseconds, surfaced as `Date` by `timestamp_ms` mode so
 * callers see the same type Postgres gave them. Cast because `unixepoch` returns
 * a float with 'subsecond', and an INTEGER column would keep it as a REAL.
 */
const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const orgRoleEnum = ["owner", "editor", "publisher", "viewer"] as const;
export const skillVisibilityEnum = ["private", "org", "public"] as const;
export const versionStatusEnum = ["draft", "published", "archived"] as const;
export const feedbackSourceEnum = ["human", "agent"] as const;
export const feedbackStatusEnum = ["pending", "approved", "rejected"] as const;
export const aiJobStatusEnum = ["queued", "running", "completed", "failed"] as const;
export const securityStatusEnum = ["pass", "advisory", "fail"] as const;
export const telemetryEventEnum = ["install", "activation"] as const;
export const evalStatusEnum = ["queued", "running", "completed", "failed"] as const;
export const skillRuntimeEnum = ["local", "sandbox", "container"] as const;
export const skillRunStatusEnum = ["queued", "running", "completed", "failed"] as const;
export const skillSourceTypeEnum = ["native", "mirror"] as const;
export const skillTrustTierEnum = ["official_mirror"] as const;
export const skillSyncStatusEnum = ["idle", "running", "success", "failed"] as const;
export const skillSourceSuggestionStatusEnum = ["pending", "approved", "rejected"] as const;
export const projectItemKindEnum = ["skill", "external"] as const;
export const projectVisibilityEnum = ["private", "shared"] as const;
export const projectRoleEnum = ["viewer", "editor", "admin"] as const;
export const failurePatternStatusEnum = ["open", "drafted", "dismissed"] as const;
export const agentApprovalStatusEnum = ["pending", "approved", "denied"] as const;

// Better Auth tables
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

// The Better Auth tables below carry explicit indexes on the columns Better
// Auth actually filters on. Without them every sign-in and session resolve is a
// sequential scan of a table that grows with each login, and sessions/accounts
// also seq-scan on cascade delete of a user.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    // Serves the expired-session pruning job as well as expiry checks.
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    // The OAuth sign-in lookup. Unique because one provider account must not be
    // linkable to two Skillist users.
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    // Every magic-link verify filters on identifier. This table grows with every
    // link sent, so an unindexed scan here degrades continuously.
    index("verifications_identifier_idx").on(t.identifier),
    index("verifications_expires_idx").on(t.expiresAt),
  ],
);

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type"),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    publishPolicy: text("publish_policy", { mode: "json" }).$type<{
      minQualityScore?: number;
      requireSecurityPass?: boolean;
      blockOnAdvisory?: boolean;
      minEvalUplift?: number;
      requireEval?: boolean;
    }>(),
    installPolicy: text("install_policy", { mode: "json" }).$type<{
      warnSeverity?: "low" | "medium" | "high" | "critical";
      blockSeverity?: "low" | "medium" | "high" | "critical";
      allowedSources?: "registry_org_only" | "registry_any" | "registry_plus_git";
      gitAllowlist?: string[];
      minReleaseAgeDays?: number;
    }>(),
    reviewRubric: text("review_rubric", { mode: "json" }).$type<{
      validationWeight?: number;
      checks?: { id: string; weight: number; enabled?: boolean }[];
      llmJudges?: {
        id: string;
        weight: number;
        prompt: string;
        evaluationTarget?: string;
      }[];
    }>(),
    executionPolicy: text("execution_policy", { mode: "json" }).$type<{
      hourlyRunLimit?: number;
      dailyRunLimit?: number;
      containerHourlyLimit?: number;
      anonymousHourlyLimit?: number;
      allowPublicRuns?: boolean;
    }>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

export const orgMembers = sqliteTable(
  "org_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: orgRoleEnum }).notNull().default("viewer"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("org_members_org_user_idx").on(t.orgId, t.userId),
    index("org_members_user_idx").on(t.userId),
  ],
);

/**
 * Pending invitations to join an org.
 *
 * `org_members` can only hold people who already have an account, so an invite
 * to someone who has never signed in needs somewhere to live until they do.
 * The emailed token is stored only as a sha256 (`tokenHash`) — the raw value
 * exists in the invitee's inbox and nowhere else, so a database leak cannot be
 * replayed into org access.
 *
 * Rows are never deleted on accept/revoke, only stamped: `acceptedAt` and
 * `revokedAt` keep the audit trail of who was let into an org and when.
 */
export const orgInvitations = sqliteTable(
  "org_invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Stored lowercased. Compared against the accepting session's verified
    // email, so an invite cannot be redeemed by whoever else gets the link.
    email: text("email").notNull(),
    role: text("role", { enum: orgRoleEnum }).notNull().default("viewer"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    // Accept looks an invitation up by hash alone, so this is both the lookup
    // index and the guarantee that one token maps to at most one invitation.
    uniqueIndex("org_invitations_token_hash_idx").on(t.tokenHash),
    index("org_invitations_org_idx").on(t.orgId),
    index("org_invitations_email_idx").on(t.email),
  ],
);

export const skills = sqliteTable(
  "skills",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    visibility: text("visibility", { enum: skillVisibilityEnum }).notNull().default("private"),
    description: text("description"),
    runtime: text("runtime", { enum: skillRuntimeEnum }).notNull().default("local"),
    latestPublishedVersionId: text("latest_published_version_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("skills_org_repo_idx").on(t.orgId, t.repo),
    index("skills_visibility_idx").on(t.visibility),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility", { enum: projectVisibilityEnum }).notNull().default("private"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("projects_org_slug_idx").on(t.orgId, t.slug),
    index("projects_org_idx").on(t.orgId),
  ],
);

export const projectItems = sqliteTable(
  "project_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: projectItemKindEnum }).notNull(),
    skillId: text("skill_id").references(() => skills.id, { onDelete: "cascade" }),
    externalUrl: text("external_url"),
    externalName: text("external_name"),
    path: text("path").notNull().default(""),
    position: integer("position").notNull().default(0),
    label: text("label"),
    note: text("note"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("project_items_project_idx").on(t.projectId),
    uniqueIndex("project_items_project_skill_idx")
      .on(t.projectId, t.skillId)
      .where(sql`skill_id is not null`),
    uniqueIndex("project_items_project_external_idx")
      .on(t.projectId, t.externalUrl)
      .where(sql`external_url is not null`),
  ],
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: projectRoleEnum }).notNull().default("viewer"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ],
);

export const skillVersions = sqliteTable(
  "skill_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    status: text("status", { enum: versionStatusEnum }).notNull().default("draft"),
    semver: text("semver").notNull(),
    r2Prefix: text("r2_prefix").notNull(),
    kvEtag: text("kv_etag"),
    qualityScore: integer("quality_score"),
    impactScore: integer("impact_score"),
    securityStatus: text("security_status", { enum: securityStatusEnum }),
    securityIssues: text("security_issues", { mode: "json" }).$type<
      { severity: string; path: string; message: string }[]
    >(),
    reviewChecks: text("review_checks", { mode: "json" }).$type<
      { id: string; label: string; passed: boolean; message: string }[]
    >(),
    pluginManifest: text("plugin_manifest", { mode: "json" }),
    parentVersionId: text("parent_version_id"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("skill_versions_skill_idx").on(t.skillId),
    index("skill_versions_status_idx").on(t.status),
    // Closes a TOCTOU: the upload path reads existing versions and compares
    // semvers in JS, so two concurrent uploads could both pass and insert the
    // same semver — after which pinned-version delivery silently picks one by
    // published_at. Also serves that pinned-version lookup.
    uniqueIndex("skill_versions_skill_semver_idx").on(t.skillId, t.semver),
    index("skill_versions_created_by_idx").on(t.createdBy),
  ],
);

export const skillFiles = sqliteTable(
  "skill_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    versionId: text("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("skill_files_version_path_idx").on(t.versionId, t.path)],
);

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    targetVersionId: text("target_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    source: text("source", { enum: feedbackSourceEnum }).notNull(),
    body: text("body").notNull(),
    suggestedPatch: text("suggested_patch"),
    status: text("status", { enum: feedbackStatusEnum }).notNull().default("pending"),
    submittedBy: text("submitted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    apiKeyId: text("api_key_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("feedback_skill_idx").on(t.skillId),
    index("feedback_status_idx").on(t.status),
    // FK used by version-scoped feedback lookups + cascade deletes.
    index("feedback_target_version_idx").on(t.targetVersionId),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    feedbackId: text("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  // Both are FKs with no prior index — cascade parent deletes seq-scanned.
  (t) => [
    index("approvals_feedback_idx").on(t.feedbackId),
    index("approvals_approved_by_idx").on(t.approvedBy),
  ],
);

export const registryEntries = sqliteTable(
  "registry_entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
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
    securityStatus: text("security_status", { enum: securityStatusEnum }),
    installCount: integer("install_count").notNull().default(0),
    activationCount: integer("activation_count").notNull().default(0),
    stars: integer("stars").notNull().default(0),
    category: text("category"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    compatibleAgents: text("compatible_agents", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    sourceType: text("source_type", { enum: skillSourceTypeEnum }).notNull().default("native"),
    upstreamRepo: text("upstream_repo"),
    upstreamUrl: text("upstream_url"),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("registry_org_skill_idx").on(t.orgSlug, t.skillRepo),
    // Retained for ORDER BY name (btree). Leading-wildcard ILIKE search can't
    // use it — the trigram GIN indexes below serve `%q%` search instead.
    // Name only: search is a substring scan no index helps, and this serves the sort.
    index("registry_name_idx").on(t.name),
    // GIN trigram indexes power the registry search's `ILIKE '%q%'` on name and
    // description. Requires the pg_trgm extension (see the migration note).
    // Search ORs these two columns as well (registry-service buildRegistryWhere);
    // without trigram indexes the OR branch forces a seq scan even when name and
    // description are indexed. Trigram-index them too.
    index("registry_category_idx").on(t.category),
    index("registry_source_type_idx").on(t.sourceType),
    // Coverage resolves entries by repo alone; the composite unique above leads
    // with org_slug and so cannot serve it.
    index("registry_skill_repo_idx").on(t.skillRepo),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("subscriptions_user_skill_idx").on(t.userId, t.skillId)],
);

export const registryStars = sqliteTable(
  "registry_stars",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("registry_stars_user_skill_idx").on(t.userId, t.skillId)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    // Optional expiry: a key past this instant is rejected at auth time.
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    // Revocation: set to disable a key while preserving its row for audit.
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("api_keys_org_idx").on(t.orgId),
    // THE hot-path index: authMiddleware looks a key up by hash on every
    // request carrying `Bearer sk_...`. Unique because two keys must never
    // share a hash.
    uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
    // Covers the cascade when a creator's user row is deleted.
    index("api_keys_created_by_idx").on(t.createdBy),
  ],
);

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    feedbackId: text("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    status: text("status", { enum: aiJobStatusEnum }).notNull().default("queued"),
    model: text("model"),
    gatewayId: text("gateway_id"),
    resultDraftVersionId: text("result_draft_version_id"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("ai_jobs_feedback_idx").on(t.feedbackId)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("audit_events_created_idx").on(t.createdAt),
    // Audit log listing filters org_id and orders by created_at desc.
    index("audit_events_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const telemetryEvents = sqliteTable(
  "telemetry_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    eventType: text("event_type", { enum: telemetryEventEnum }).notNull(),
    projectHash: text("project_hash"),
    // Which agent harness the skill was delivered to, and whether it landed in
    // the project or the user's home directory (`skillist sync`). Deliberately
    // `text` rather than a pgEnum: the set of harnesses grows on someone else's
    // release schedule, and `harnessSchema` in @skillist/contracts is the
    // validating boundary, so a new one must not require a migration.
    harness: text("harness"),
    scope: text("scope"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    // Every index here is another row written per event, on the one table written
    // on every install and activation. Keep this list short: drop any index whose
    // columns are a prefix of another, and any too unselective to be used.
    // Retention prunes by age; without this it scans the whole table.
    index("telemetry_created_idx").on(t.createdAt),
    // Analytics filters (org_slug, skill_repo) over a created_at window and
    // groups by day (observability + org telemetry routes). `harness` trails
    // the window column so the per-harness breakdown is served by this index
    // too — this is the fastest-growing table, so it earns one index, not two.
    index("telemetry_skill_created_idx").on(t.orgSlug, t.skillRepo, t.createdAt, t.harness),
    // The coverage query filters on skill_repo alone, which the composite
    // indexes above cannot serve since they lead with org_slug. This is the
    // fastest-growing table, so an unindexed predicate here degrades fastest.
    index("telemetry_repo_idx").on(t.skillRepo),
    index("telemetry_user_idx").on(t.userId),
  ],
);

export const skillEvals = sqliteTable(
  "skill_evals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    status: text("status", { enum: evalStatusEnum }).notNull().default("queued"),
    scenarios: text("scenarios", { mode: "json" }).$type<{ name: string; prompt: string }[]>(),
    baselineScore: integer("baseline_score"),
    withSkillScore: integer("with_skill_score"),
    uplift: integer("uplift"),
    results: text("results", { mode: "json" }).$type<
      {
        name: string;
        prompt: string;
        baselineScore: number;
        withSkillScore: number;
        uplift: number;
      }[]
    >(),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("skill_evals_skill_idx").on(t.skillId),
    // Public skill-detail reads the latest eval by (version_id, status) ordered
    // by completed_at; version_id was an unindexed FK before this.
    index("skill_evals_version_idx").on(t.versionId, t.status, t.completedAt),
  ],
);

export const orgRequiredSkills = sqliteTable(
  "org_required_skills",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("org_required_skills_idx").on(t.orgId, t.orgSlug, t.skillRepo)],
);

export const skillInventory = sqliteTable(
  "skill_inventory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repoFullName: text("repo_full_name").notNull(),
    filePath: text("file_path").notNull(),
    localSlug: text("local_slug"),
    managed: integer("managed", { mode: "boolean" }).notNull().default(false),
    registryOrgSlug: text("registry_org_slug"),
    registryRepo: text("registry_repo"),
    sourceType: text("source_type"),
    scope: text("scope"),
    marketplace: text("marketplace"),
    pluginName: text("plugin_name"),
    isSymlink: integer("is_symlink", { mode: "boolean" }).notNull().default(false),
    conformanceStatus: text("conformance_status"),
    conformanceIssues: text("conformance_issues", { mode: "json" }).$type<
      { level: string; field?: string; message: string }[]
    >(),
    contentHash: text("content_hash"),
    securityStatus: text("security_status", { enum: securityStatusEnum }),
    securityIssues: text("security_issues", { mode: "json" }).$type<
      { severity: string; path: string; message: string }[]
    >(),
    scannedAt: integer("scanned_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("skill_inventory_repo_path_idx").on(t.orgId, t.repoFullName, t.filePath)],
);

export const orgMcpServers = sqliteTable(
  "org_mcp_servers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("org_mcp_servers_org_name_idx").on(t.orgId, t.name)],
);

export const skillRuns = sqliteTable(
  "skill_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    scriptPath: text("script_path").notNull(),
    runtime: text("runtime", { enum: skillRuntimeEnum }).notNull(),
    status: text("status", { enum: skillRunStatusEnum }).notNull().default("queued"),
    args: text("args", { mode: "json" }).$type<string[]>(),
    targetUrl: text("target_url"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    actorId: text("actor_id"),
    actorType: text("actor_type"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("skill_runs_created_idx").on(t.createdAt),
    // Run-quota counts join skill_id over a created_at window on every hosted
    // run; a composite index serves those hot COUNT(*) queries directly.
    index("skill_runs_skill_created_idx").on(t.skillId, t.createdAt),
    // The observability dashboard filters on (org_slug, created_at) across four
    // separate queries; no existing index leads with org_slug.
    index("skill_runs_org_created_idx").on(t.orgSlug, t.createdAt),
    index("skill_runs_version_idx").on(t.versionId),
  ],
);

export const skillFailurePatterns = sqliteTable(
  "skill_failure_patterns",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    skillRepo: text("skill_repo").notNull(),
    // Cluster key: a stable hash of the representative failure, used to dedupe
    // recurring patterns across mining runs.
    signature: text("signature").notNull(),
    summary: text("summary").notNull(),
    suggestedFix: text("suggested_fix"),
    occurrences: integer("occurrences").notNull().default(1),
    exemplarRunIds: text("exemplar_run_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status", { enum: failurePatternStatusEnum }).notNull().default("open"),
    // Set once an agent-drafted feedback row is opened for this pattern.
    feedbackId: text("feedback_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("skill_failure_patterns_sig_idx").on(t.skillId, t.signature),
    index("skill_failure_patterns_skill_idx").on(t.skillId),
    index("skill_failure_patterns_status_idx").on(t.status),
  ],
);

export const skillSources = sqliteTable(
  "skill_sources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    discoveryRoots: text("discovery_roots", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(["skills"]),
    trustTier: text("trust_tier", { enum: skillTrustTierEnum })
      .notNull()
      .default("official_mirror"),
    syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(true),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastCommitSha: text("last_commit_sha"),
    lastSyncStatus: text("last_sync_status", { enum: skillSyncStatusEnum })
      .notNull()
      .default("idle"),
    lastSyncError: text("last_sync_error"),
    pendingCommitSha: text("pending_commit_sha"),
    pendingPublishCount: integer("pending_publish_count").notNull().default(0),
    license: text("license"),
    homepageUrl: text("homepage_url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("skill_sources_owner_repo_idx").on(t.githubOwner, t.githubRepo),
    index("skill_sources_sync_enabled_idx").on(t.syncEnabled),
  ],
);

export const skillSourceSuggestions = sqliteTable(
  "skill_source_suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    discoveredVia: text("discovered_via").notNull(),
    stars: integer("stars").notNull().default(0),
    license: text("license"),
    matchScore: integer("match_score").notNull().default(0),
    status: text("status", { enum: skillSourceSuggestionStatusEnum }).notNull().default("pending"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("skill_source_suggestions_owner_repo_idx").on(t.githubOwner, t.githubRepo),
    index("skill_source_suggestions_status_idx").on(t.status),
  ],
);

export const skillProvenance = sqliteTable(
  "skill_provenance",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" })
      .unique(),
    sourceId: text("source_id").references(() => skillSources.id, { onDelete: "set null" }),
    sourcePath: text("source_path").notNull(),
    sourceCommitSha: text("source_commit_sha"),
    sourceUrl: text("source_url"),
    contentHash: text("content_hash").notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("skill_provenance_source_idx").on(t.sourceId)],
);

// Better Auth MCP (OAuth provider) tables, from @better-auth/mcp. Better Auth owns
// these shapes: string[] and json fields are stored as JSON text. Every user and
// client reference cascades so account deletion can't be blocked by a token row.
export const oauthClients = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: integer("disabled", { mode: "boolean" }),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("client_credentials_scopes"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: integer("backchannel_logout_session_required", {
      mode: "boolean",
    }),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpop_bound_access_tokens", { mode: "boolean" }),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (t) => [index("oauth_client_user_idx").on(t.userId)],
);

export const oauthResources = sqliteTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes"),
  customClaims: text("custom_claims"),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", {
    mode: "boolean",
  }),
  disabled: integer("disabled", { mode: "boolean" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version"),
  metadata: text("metadata"),
});

export const oauthClientResources = sqliteTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("oauth_client_resource_client_idx").on(t.clientId),
    index("oauth_client_resource_resource_idx").on(t.resourceId),
    uniqueIndex("oauth_client_resource_unique_idx").on(t.clientId, t.resourceId),
  ],
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: integer("rotation_replay_expires_at", { mode: "timestamp_ms" }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauth_refresh_token_client_idx").on(t.clientId),
    index("oauth_refresh_token_session_idx").on(t.sessionId),
    index("oauth_refresh_token_user_idx").on(t.userId),
    index("oauth_refresh_token_code_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_session_idx").on(t.sessionId),
    index("oauth_access_token_user_idx").on(t.userId),
    index("oauth_access_token_code_idx").on(t.authorizationCodeId),
    index("oauth_access_token_refresh_idx").on(t.refreshId),
  ],
);

export const oauthConsents = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ],
);

export const oauthClientAssertions = sqliteTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

// Signing keys for MCP access tokens. Better Auth encrypts privateKey with
// BETTER_AUTH_SECRET, so rotating that secret also invalidates these keys.
export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  alg: text("alg"),
  crv: text("crv"),
});

// Platform-agent v2: per-user chats, durable memory, HITL approvals
export const agentChats = sqliteTable(
  "agent_chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    index("agent_chats_org_user_idx").on(t.orgId, t.userId),
    // Newest-first history listing orders by updated_at desc.
    index("agent_chats_updated_idx").on(t.updatedAt),
  ],
);

export const agentMemory = sqliteTable(
  "agent_memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Null userId = org-wide memory; set-null on user delete preserves org facts.
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userScope: text("user_scope").generatedAlwaysAs(sql`coalesce(user_id, '')`, {
      mode: "virtual",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    // SQLite treats NULLs as distinct in a unique index, so org-wide facts (a null
    // user_id) would never dedupe on user_id itself. user_scope is why it exists.
    uniqueIndex("agent_memory_org_user_key_idx").on(t.orgId, t.userScope, t.key),
    index("agent_memory_org_user_idx").on(t.orgId, t.userId),
  ],
);

export const agentApprovals = sqliteTable(
  "agent_approvals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    // sha256 of the sorted tool-call args — dedupes identical pending requests.
    callSignature: text("call_signature").notNull(),
    args: text("args", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: agentApprovalStatusEnum }).notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("agent_approvals_call_idx").on(t.orgId, t.userId, t.toolName, t.callSignature),
    index("agent_approvals_org_user_status_idx").on(t.orgId, t.userId, t.status),
  ],
);
