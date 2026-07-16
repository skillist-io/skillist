const API_URL = import.meta.env.VITE_API_URL ?? "";

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return res.text() as Promise<T>;
}

export type RegistryItem = {
  orgSlug: string;
  skillSlug: string;
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
  installCommand?: string;
  runCommand?: string | null;
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
  status: string;
  baselineScore: number | null;
  withSkillScore: number | null;
  uplift: number | null;
  createdAt: string;
  completedAt: string | null;
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
  slug: string;
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
};
