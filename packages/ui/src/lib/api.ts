import { clientFetchBase } from "./client-api-base";

/**
 * A non-ok API response.
 *
 * Extends Error, so existing `catch (e) { e.message }` handling is unchanged —
 * but it also keeps the status and the parsed body, which some responses carry
 * structured detail in (e.g. the 409 from account deletion lists the orgs
 * blocking it). Previously that detail was parsed and thrown away.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${clientFetchBase()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach the Skillist API");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError((err as { error?: string }).error ?? "Request failed", res.status, err);
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return res.text() as Promise<T>;
}

export type RegistryItem = {
  /** Backing skills.id — present for registry entries so they curate as real skill items. */
  skillId?: string;
  orgSlug: string;
  skillRepo: string;
  name: string;
  description: string;
  latestVersion: string | null;
  stars: number;
  qualityScore: number | null;
  impactScore: number | null;
  securityStatus: string | null;
  installCount: number;
  activationCount: number;
  runtime?: string | null;
  category?: string | null;
  tags?: string[];
  compatibleAgents?: string[];
  /** Origin: native (published on Skillist) or mirror (synced from GitHub). */
  sourceType?: "native" | "mirror";
  upstreamRepo?: string | null;
  upstreamUrl?: string | null;
  starred?: boolean;
  installCommand?: string;
  cliInstall?: string;
  runCommand?: string | null;
  pluginManifest?: Record<string, unknown> | null;
  eval?: {
    status: string;
    uplift: number | null;
    baselineScore: number | null;
    withSkillScore: number | null;
    completedAt: string | null;
  } | null;
};

export type SkillRunResult = {
  runId: string;
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  runtime: string;
};

export type SkillRun = {
  id: string;
  orgSlug?: string;
  skillRepo?: string;
  scriptPath: string;
  runtime: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ExecutionPolicy = {
  hourlyRunLimit?: number;
  dailyRunLimit?: number;
  containerHourlyLimit?: number;
  anonymousHourlyLimit?: number;
};

export type PublishPolicy = {
  minQualityScore?: number;
  requireSecurityPass?: boolean;
  blockOnAdvisory?: boolean;
  minEvalUplift?: number;
  requireEval?: boolean;
};

export type InstallPolicy = {
  warnSeverity?: "low" | "medium" | "high" | "critical";
  blockSeverity?: "low" | "medium" | "high" | "critical";
  allowedSources?: "registry_org_only" | "registry_any" | "registry_plus_git";
  gitAllowlist?: string[];
  minReleaseAgeDays?: number;
};

export type AuditEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  actorType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type SkillEval = {
  id: string;
  versionId?: string;
  semver?: string;
  versionStatus?: string;
  status: string;
  baselineScore: number | null;
  withSkillScore: number | null;
  uplift: number | null;
  results?:
    | {
        name: string;
        prompt: string;
        baselineScore: number;
        withSkillScore: number;
        uplift: number;
      }[]
    | null;
  error?: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ObservabilitySummary = {
  telemetry: {
    events: number;
    installs: number;
    activations: number;
    bySkill: {
      skillRepo: string;
      installCount: number;
      activationCount: number;
    }[];
  };
  runs: {
    total: number;
    finished: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number;
    byRuntime: Record<string, number>;
    recent: SkillRun[];
  };
  series: {
    runs: { date: string; count: number }[];
    successes: { date: string; count: number }[];
    installs: { date: string; count: number }[];
    activations: { date: string; count: number }[];
  };
};

/**
 * Required-skill coverage across three layers: published (in registry) →
 * covered (present in scanned inventory repos and/or curated into projects) →
 * activated (agents actually ran it, from telemetry). `drift` lists refs that
 * are required but not covered — the actionable set a governing team must fix.
 */
export type CoverageSkill = {
  ref: string;
  orgSlug: string;
  skillRepo: string;
  published: boolean;
  inventoryCount: number;
  projectCount: number;
  covered: boolean;
  installs: number;
  activations: number;
  activated: boolean;
  lastActivatedAt: string | null;
};

export type Coverage = {
  summary: {
    required: number;
    published: number;
    covered: number;
    activated: number;
    drifted: number;
    coveragePct: number;
  };
  skills: CoverageSkill[];
  drift: string[];
};

export type ReviewPreview = {
  qualityScore: number;
  impactScore: number;
  securityStatus: string;
  reviewChecks: { id: string; label: string; passed: boolean; message: string }[];
  securityIssues: { severity: string; path: string; message: string }[];
};

export type Org = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type Skill = {
  id: string;
  repo: string;
  visibility: string;
  description: string | null;
};

export type SkillVersion = {
  id: string;
  skillId: string;
  status: string;
  semver: string;
  publishedAt: string | null;
  createdAt: string;
  qualityScore: number | null;
  impactScore: number | null;
  securityStatus: string | null;
  reviewChecks: { id: string; label: string; passed: boolean; message: string }[] | null;
  securityIssues: { severity: string; path: string; message: string }[] | null;
};

export type Feedback = {
  id: string;
  skillId: string;
  targetVersionId: string;
  source: string;
  body: string;
  suggestedPatch: string | null;
  status: string;
  createdAt: string;
  aiJob?: {
    id: string;
    status: string;
    resultDraftVersionId: string | null;
    error: string | null;
    completedAt: string | null;
    draftSemver: string | null;
  } | null;
};

/**
 * A recurring skill-run/eval failure surfaced by the failure-mining pipeline.
 * The miner clusters failed runs and weak evals; once a cluster reaches ~3
 * occurrences it drafts an improvement as a pending `feedback` item, linked
 * here via `feedbackId` (and reflected as `status: "drafted"`).
 */
export type FailurePattern = {
  id: string;
  skillRepo: string;
  orgSlug: string;
  summary: string;
  suggestedFix: string | null;
  occurrences: number;
  status: "open" | "drafted" | "dismissed";
  feedbackId: string | null;
  updatedAt: string;
};

export type SkillInventoryItem = {
  id: string;
  orgId: string;
  repoFullName: string;
  filePath: string;
  localSlug: string | null;
  managed: boolean;
  registryOrgSlug: string | null;
  registryRepo: string | null;
  /** Backing skills.id when the managed item resolves to a public registry skill. */
  skillId?: string | null;
  sourceType?: string | null;
  scope?: string | null;
  marketplace?: string | null;
  pluginName?: string | null;
  isSymlink?: boolean;
  conformanceStatus?: string | null;
  contentHash?: string | null;
  securityStatus?: string | null;
  securityIssues?: { severity: string; path: string; message: string }[] | null;
  scannedAt: string;
};

export type SkillSource = {
  id: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  discoveryRoots: string[];
  trustTier: string;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  lastCommitSha: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  pendingCommitSha: string | null;
  pendingPublishCount: number;
  license: string | null;
  homepageUrl: string | null;
  updatedAt: string;
};

export type ProjectVisibility = "private" | "shared";
export type ProjectRole = "viewer" | "editor" | "admin";

export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  itemCount: number;
  visibility: ProjectVisibility;
  /** Whether the current user can curate (editor+). */
  canWrite: boolean;
  /** The current user's project role, or null when access is inherited (e.g. org owner). */
  role: ProjectRole | null;
};

export type ProjectMember = {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  addedBy: string | null;
  createdAt: string;
};

export type OrgMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

type ProjectItemBase = {
  id: string;
  path: string;
  position: number;
  label: string | null;
  note: string | null;
};

export type ProjectItem =
  | (ProjectItemBase & {
      kind: "skill";
      skillId: string;
      orgSlug: string;
      repo: string;
      visibility: "private" | "org" | "public";
      description: string | null;
    })
  | (ProjectItemBase & {
      kind: "external";
      externalUrl: string;
      externalName: string | null;
    });

export type ProjectDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  items: ProjectItem[];
  visibility: ProjectVisibility;
  /** The current user's project role, or null when access is inherited (e.g. org owner). */
  role: ProjectRole | null;
  /** Whether the current user can curate items (editor+). */
  canWrite: boolean;
  /** Whether the current user can manage visibility, members, and deletion (admin / org owner). */
  canManage: boolean;
};

export type SkillSourceSuggestion = {
  id: string;
  githubOwner: string;
  githubRepo: string;
  discoveredVia: string;
  stars: number;
  license: string | null;
  matchScore: number;
  status: string;
  createdAt: string;
};
