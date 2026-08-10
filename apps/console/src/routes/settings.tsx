import { oauthRedirectUris } from "@skillist/auth";
import {
  type AuditEvent,
  api,
  apiUrl,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyButton,
  type ExecutionPolicy,
  Input,
  type InstallPolicy,
  Label,
  NativeSelect,
  PageTitle,
  type PublishPolicy,
  SegmentedControl,
  Switch,
  type Theme,
  useTheme,
} from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/active-org";
import { requireAuth } from "@/lib/require-auth";

const API_SCOPES = [
  "skills:read",
  "skills:write",
  "skills:run",
  "skills:publish",
  "feedback:submit",
  "feedback:approve",
] as const;

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
};

const redirects = oauthRedirectUris(import.meta.env.VITE_API_URL ?? "http://localhost:8787");

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuth(),
  component: SettingsPage,
});

function SettingsPage() {
  const { activeOrg } = useActiveOrg();
  // Settings management (org OAuth + API keys) is owner-only.
  const isOwner = activeOrg?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="text-muted-foreground">
          Org OAuth setup and agent API keys. Personal profile and passkeys are on{" "}
          <Link to="/account" className="text-primary underline">
            Account
          </Link>
          .
        </p>
      </div>

      <AppearanceCard />

      <Card size="sm" id="github-oauth">
        <CardHeader>
          <CardTitle>GitHub OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              GitHub OAuth setup guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Create a GitHub OAuth App and set the callback URL to:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto bg-muted px-2 py-1.5 font-mono text-xs">
              {redirects.github}
            </code>
            <CopyButton value={redirects.github} label="Copy" size="sm" />
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Google OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Google OAuth setup guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Add this authorized redirect URI in Google Cloud Console:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto bg-muted px-2 py-1.5 font-mono text-xs">
              {redirects.google}
            </code>
            <CopyButton value={redirects.google} label="Copy" size="sm" />
          </div>
        </CardContent>
      </Card>

      <Card size="sm" id="api-keys">
        <CardHeader>
          <CardTitle>Agent API keys</CardTitle>
          <CardDescription>
            Scoped keys for CLI and agent clients. Docs at{" "}
            <a
              href={apiUrl("/docs")}
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              {apiUrl("/docs")}
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!activeOrg ? (
            <p className="text-sm text-muted-foreground">
              Create an organization on the dashboard to manage API keys.
            </p>
          ) : !isOwner ? (
            // Permission state (not an error) — the global switcher lists every
            // org, so surface the gate here instead of switching orgs.
            <div className="border border-border p-6">
              <h3 className="text-sm font-semibold text-foreground">Owner access required</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Managing settings for {activeOrg.name} needs an owner role. You have the{" "}
                {activeOrg.role} role.
              </p>
            </div>
          ) : (
            <>
              <ApiKeyManager orgId={activeOrg.id} />
              <p className="text-sm text-muted-foreground">
                Publish policies, quotas, and audit logs are on the{" "}
                <a href="/governance" className="text-primary underline">
                  Governance
                </a>{" "}
                page.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Theme lives here rather than in the app chrome.
 *
 * A toggle in the header invites fiddling with a setting most people choose
 * once, and it spent a slot in a bar reserved for things you act on often. It
 * is a preference, so it sits with the other preferences.
 *
 * The choice is stored in a cookie scoped to the parent domain, so it applies
 * to the marketing site as well as the console.
 */
const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function AppearanceCard() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <Card size="sm" id="appearance">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Skillist is dark by default. Choose light, or follow your operating system. Applies to the
          public site too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Theme"
          value={theme}
          onChange={(next) => setTheme(next as Theme)}
          options={THEME_OPTIONS}
        />
        {/* "System" alone does not say which way it resolved right now. */}
        {theme === "system" && (
          <span className="font-mono text-xs text-muted-foreground">
            following your system · currently {resolvedTheme}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeyManager({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["skills:read", "skills:write"]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: keys } = useQuery({
    queryKey: ["api-keys", orgId],
    queryFn: () => api<ApiKeyRow[]>(`/v1/orgs/${orgId}/api-keys`),
  });

  const createKey = useMutation({
    mutationFn: () =>
      api<{ id: string; key: string; prefix: string }>(`/v1/orgs/${orgId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ name, scopes }),
      }),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: string) => api(`/v1/orgs/${orgId}/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] }),
  });

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 border border-border p-4">
        <Label>Create key</Label>
        <Input placeholder="CI deploy key" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {API_SCOPES.map((scope) => (
            <Button
              key={scope}
              type="button"
              size="sm"
              variant={scopes.includes(scope) ? "default" : "outline"}
              onClick={() => toggleScope(scope)}
            >
              {scope}
            </Button>
          ))}
        </div>
        <Button
          onClick={() => createKey.mutate()}
          disabled={!name || scopes.length === 0 || createKey.isPending}
        >
          Create API key
        </Button>
        {createdKey && (
          <div className="space-y-2 border border-border bg-muted/50 p-3 text-sm">
            <p className="font-medium">Copy this key now. It won&apos;t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto bg-background px-2 py-1.5 font-mono text-xs break-all">
                {createdKey}
              </code>
              <CopyButton value={createdKey} label="Copy key" size="sm" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Active keys</Label>
        {!keys?.length ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between border border-border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{key.name}</p>
                <p className="text-muted-foreground">
                  {key.prefix}… ·{" "}
                  {key.scopes.map((s) => (
                    <Badge key={s} className="mr-1">
                      {s}
                    </Badge>
                  ))}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => revokeKey.mutate(key.id)}
                disabled={revokeKey.isPending}
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function GovernancePanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [minQuality, setMinQuality] = useState(60);
  const [requirePass, setRequirePass] = useState(false);
  const [blockAdvisory, setBlockAdvisory] = useState(true);
  const [requireEval, setRequireEval] = useState(false);
  const [minEvalUplift, setMinEvalUplift] = useState(0);
  const [warnSeverity, setWarnSeverity] = useState<"low" | "medium" | "high" | "critical">(
    "medium",
  );
  const [blockSeverity, setBlockSeverity] = useState<"low" | "medium" | "high" | "critical">(
    "high",
  );
  const [allowedSources, setAllowedSources] = useState<
    "registry_org_only" | "registry_any" | "registry_plus_git"
  >("registry_any");
  const [gitAllowlist, setGitAllowlist] = useState("");
  const [minReleaseAgeDays, setMinReleaseAgeDays] = useState(0);
  const [hourlyRuns, setHourlyRuns] = useState(50);
  const [dailyRuns, setDailyRuns] = useState(500);
  const [containerHourly, setContainerHourly] = useState(10);
  const [anonymousHourly, setAnonymousHourly] = useState(10);
  const [allowPublicRuns, setAllowPublicRuns] = useState(false);
  const [requiredOrgSlug, setRequiredOrgSlug] = useState("");
  const [requiredSkillSlug, setRequiredSkillSlug] = useState("");

  const { data: policyData } = useQuery({
    queryKey: ["publish-policy", orgId],
    queryFn: () => api<{ publishPolicy: PublishPolicy }>(`/v1/orgs/${orgId}/publish-policy`),
  });

  const { data: executionData } = useQuery({
    queryKey: ["execution-policy", orgId],
    queryFn: () => api<{ executionPolicy: ExecutionPolicy }>(`/v1/orgs/${orgId}/execution-policy`),
  });

  const { data: installData } = useQuery({
    queryKey: ["install-policy", orgId],
    queryFn: () => api<{ installPolicy: InstallPolicy }>(`/v1/orgs/${orgId}/install-policy`),
  });

  const { data: auditData } = useQuery({
    queryKey: ["audit", orgId],
    queryFn: () => api<{ items: AuditEvent[] }>(`/v1/orgs/${orgId}/audit?limit=20`),
  });

  const { data: telemetryData } = useQuery({
    queryKey: ["telemetry", orgId],
    queryFn: () =>
      api<{
        events: number;
        installs: number;
        activations: number;
        bySkill: { skillRepo: string; installCount: number; activationCount: number }[];
      }>(`/v1/orgs/${orgId}/telemetry`),
  });

  const { data: requiredData } = useQuery({
    queryKey: ["required-skills", orgId],
    queryFn: () =>
      api<{ items: { id: string; orgSlug: string; skillRepo: string }[] }>(
        `/v1/orgs/${orgId}/required-skills`,
      ),
  });

  useEffect(() => {
    const p = policyData?.publishPolicy;
    if (p) {
      if (p.minQualityScore != null) setMinQuality(p.minQualityScore);
      if (p.requireSecurityPass != null) setRequirePass(p.requireSecurityPass);
      if (p.blockOnAdvisory != null) setBlockAdvisory(p.blockOnAdvisory);
      if (p.requireEval != null) setRequireEval(p.requireEval);
      if (p.minEvalUplift != null) setMinEvalUplift(p.minEvalUplift);
    }
  }, [policyData]);

  useEffect(() => {
    const p = executionData?.executionPolicy;
    if (p) {
      if (p.hourlyRunLimit != null) setHourlyRuns(p.hourlyRunLimit);
      if (p.dailyRunLimit != null) setDailyRuns(p.dailyRunLimit);
      if (p.containerHourlyLimit != null) setContainerHourly(p.containerHourlyLimit);
      if (p.anonymousHourlyLimit != null) setAnonymousHourly(p.anonymousHourlyLimit);
      if (p.allowPublicRuns != null) setAllowPublicRuns(p.allowPublicRuns);
    }
  }, [executionData]);

  useEffect(() => {
    const p = installData?.installPolicy;
    if (p) {
      if (p.warnSeverity) setWarnSeverity(p.warnSeverity);
      if (p.blockSeverity) setBlockSeverity(p.blockSeverity);
      if (p.allowedSources) setAllowedSources(p.allowedSources);
      if (p.gitAllowlist) setGitAllowlist(p.gitAllowlist.join(", "));
      if (p.minReleaseAgeDays != null) setMinReleaseAgeDays(p.minReleaseAgeDays);
    }
  }, [installData]);

  const savePolicy = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/publish-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          minQualityScore: minQuality,
          requireSecurityPass: requirePass,
          blockOnAdvisory: blockAdvisory,
          requireEval,
          minEvalUplift: minEvalUplift,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-policy", orgId] }),
  });

  const saveExecutionPolicy = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/execution-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          hourlyRunLimit: hourlyRuns,
          dailyRunLimit: dailyRuns,
          containerHourlyLimit: containerHourly,
          anonymousHourlyLimit: anonymousHourly,
          allowPublicRuns,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["execution-policy", orgId] }),
  });

  const saveInstallPolicy = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/install-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          warnSeverity,
          blockSeverity,
          allowedSources,
          gitAllowlist: gitAllowlist
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          minReleaseAgeDays: minReleaseAgeDays || undefined,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["install-policy", orgId] }),
  });

  const addRequired = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/required-skills`, {
        method: "POST",
        body: JSON.stringify({
          orgSlug: requiredOrgSlug,
          skillRepo: requiredSkillSlug,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["required-skills", orgId] });
      setRequiredOrgSlug("");
      setRequiredSkillSlug("");
    },
  });

  const removeRequired = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/orgs/${orgId}/required-skills/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["required-skills", orgId] }),
  });

  return (
    <div className="space-y-4">
      <Card size="sm" id="governance">
        <CardHeader>
          <CardTitle>Publish policies</CardTitle>
          <CardDescription>
            Block publishes that don&apos;t meet quality or security thresholds
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Minimum quality score (0–100)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={minQuality}
              onChange={(e) => setMinQuality(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="require-security-pass"
              checked={requirePass}
              onCheckedChange={setRequirePass}
            />
            <label htmlFor="require-security-pass" className="text-sm">
              Require security pass (no advisories or failures)
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="block-advisory"
              checked={blockAdvisory}
              onCheckedChange={setBlockAdvisory}
            />
            <label htmlFor="block-advisory" className="text-sm">
              Block publish on security advisories
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="require-eval" checked={requireEval} onCheckedChange={setRequireEval} />
            <label htmlFor="require-eval" className="text-sm">
              Require completed eval before publish
            </label>
          </div>
          <div>
            <Label>Minimum eval uplift (-100 to 100)</Label>
            <Input
              type="number"
              min={-100}
              max={100}
              value={minEvalUplift}
              onChange={(e) => setMinEvalUplift(Number(e.target.value))}
            />
          </div>
          <Button onClick={() => savePolicy.mutate()} disabled={savePolicy.isPending}>
            Save policy
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" id="install-policy">
        <CardHeader>
          <CardTitle>Install policies</CardTitle>
          <CardDescription>
            Warn or block CLI installs that fail security or source rules
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Warn severity</Label>
              <NativeSelect
                className="mt-1 w-full"
                value={warnSeverity}
                onChange={(e) => setWarnSeverity(e.target.value as typeof warnSeverity)}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </NativeSelect>
            </div>
            <div>
              <Label>Block severity</Label>
              <NativeSelect
                className="mt-1 w-full"
                value={blockSeverity}
                onChange={(e) => setBlockSeverity(e.target.value as typeof blockSeverity)}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </NativeSelect>
            </div>
          </div>
          <div>
            <Label>Allowed sources</Label>
            <NativeSelect
              className="mt-1 w-full"
              value={allowedSources}
              onChange={(e) => setAllowedSources(e.target.value as typeof allowedSources)}
            >
              <option value="registry_org_only">Registry — this org only</option>
              <option value="registry_any">Registry — any org</option>
              <option value="registry_plus_git">Registry + git allowlist</option>
            </NativeSelect>
          </div>
          <div>
            <Label>Git allowlist (comma-separated hosts/orgs)</Label>
            <Input
              value={gitAllowlist}
              onChange={(e) => setGitAllowlist(e.target.value)}
              placeholder="github.com/acme"
            />
          </div>
          <div>
            <Label>Minimum release age (days)</Label>
            <Input
              type="number"
              min={0}
              max={365}
              value={minReleaseAgeDays}
              onChange={(e) => setMinReleaseAgeDays(Number(e.target.value))}
            />
          </div>
          <Button onClick={() => saveInstallPolicy.mutate()} disabled={saveInstallPolicy.isPending}>
            Save install policy
          </Button>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Execution quotas</CardTitle>
          <CardDescription>Limit hosted script runs per organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Hourly run limit</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={hourlyRuns}
                onChange={(e) => setHourlyRuns(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Daily run limit</Label>
              <Input
                type="number"
                min={1}
                max={100000}
                value={dailyRuns}
                onChange={(e) => setDailyRuns(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Container runs / hour</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={containerHourly}
                onChange={(e) => setContainerHourly(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Anonymous public runs / hour</Label>
              <Input
                type="number"
                min={0}
                max={1000}
                value={anonymousHourly}
                onChange={(e) => setAnonymousHourly(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="allow-public-runs"
              checked={allowPublicRuns}
              onCheckedChange={setAllowPublicRuns}
            />
            <label htmlFor="allow-public-runs" className="text-sm">
              Let other organizations run this org's public skills
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            Off by default. Public makes a skill readable by anyone; running it spends this
            organization's run quota and sandbox compute, so callers outside this organization are
            refused unless you turn this on.
          </p>
          <Button
            onClick={() => saveExecutionPolicy.mutate()}
            disabled={saveExecutionPolicy.isPending}
          >
            Save quotas
          </Button>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Required skills</CardTitle>
          <CardDescription>Skills every project in this org should install</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="registry-org"
              value={requiredOrgSlug}
              onChange={(e) => setRequiredOrgSlug(e.target.value)}
            />
            <Input
              placeholder="skill-slug"
              value={requiredSkillSlug}
              onChange={(e) => setRequiredSkillSlug(e.target.value)}
            />
            <Button
              onClick={() => addRequired.mutate()}
              disabled={!requiredOrgSlug || !requiredSkillSlug}
            >
              Add
            </Button>
          </div>
          {requiredData?.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between border border-border px-3 py-2 text-sm"
            >
              <span>
                {item.orgSlug}/{item.skillRepo}
              </span>
              <Button size="sm" variant="outline" onClick={() => removeRequired.mutate(item.id)}>
                Remove
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Telemetry funnel</CardTitle>
          <CardDescription>Published → installed → activated (last 30 days)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{telemetryData?.events ?? 0} events recorded</p>
          <p>
            {telemetryData?.installs ?? 0} installs · {telemetryData?.activations ?? 0} activations
          </p>
          {telemetryData?.bySkill?.map((s) => (
            <div key={s.skillRepo} className="flex justify-between border border-border px-2 py-1">
              <span>{s.skillRepo}</span>
              <span className="text-muted-foreground">
                {s.installCount} / {s.activationCount}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Recent governance and publish events</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {auditData?.items?.length ? (
            auditData.items.map((e) => (
              <div key={e.id} className="border border-border px-2 py-1">
                <div className="flex justify-between">
                  <span className="font-medium">{e.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {e.resourceType} {e.resourceId ?? ""}
                </p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No audit events yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
