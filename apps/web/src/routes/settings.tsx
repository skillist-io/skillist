import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api, type Org, type PublishPolicy, type ExecutionPolicy, type AuditEvent } from "@/lib/api";
import { apiUrl } from "@/lib/api-url";
import { oauthRedirectUris } from "@skillist/auth";
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

const redirects = oauthRedirectUris(
  import.meta.env.VITE_API_URL ?? "http://localhost:8787",
);

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuth(),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const ownerOrgs = orgs?.filter((o) => o.role === "owner") ?? [];
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const activeOrgId = selectedOrgId || ownerOrgs[0]?.id || "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Passwordless auth, API keys, and org membership
        </p>
      </div>

      <Card id="github-oauth">
        <CardHeader>
          <CardTitle>GitHub OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://better-auth.com/docs/authentication/github"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Better Auth GitHub guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Create a GitHub OAuth App and set the callback URL to:</p>
          <code className="block rounded bg-muted px-2 py-1">{redirects.github}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://better-auth.com/docs/authentication/google"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Better Auth Google guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Add this authorized redirect URI in Google Cloud Console:</p>
          <code className="block rounded bg-muted px-2 py-1">{redirects.google}</code>
        </CardContent>
      </Card>

      <Card id="api-keys">
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
          {ownerOrgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create an organization on the dashboard to manage API keys.
            </p>
          ) : (
            <>
              {ownerOrgs.length > 1 && (
                <div>
                  <Label>Organization</Label>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={activeOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                  >
                    {ownerOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {activeOrgId && (
                <>
                  <ApiKeyManager orgId={activeOrgId} />
                  <p className="text-sm text-muted-foreground">
                    Publish policies, quotas, and audit logs are on the{" "}
                    <a href="/governance" className="text-primary underline">
                      Governance
                    </a>{" "}
                    page.
                  </p>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiKeyManager({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([
    "skills:read",
    "skills:write",
  ]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: keys } = useQuery({
    queryKey: ["api-keys", orgId],
    queryFn: () => api<ApiKeyRow[]>(`/v1/orgs/${orgId}/api-keys`),
  });

  const createKey = useMutation({
    mutationFn: () =>
      api<{ id: string; key: string; prefix: string }>(
        `/v1/orgs/${orgId}/api-keys`,
        {
          method: "POST",
          body: JSON.stringify({ name, scopes }),
        },
      ),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: string) =>
      api(`/v1/orgs/${orgId}/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] }),
  });

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-4">
        <Label>Create key</Label>
        <Input
          placeholder="CI deploy key"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
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
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium">Copy this key now — it won&apos;t be shown again:</p>
            <code className="mt-1 block break-all">{createdKey}</code>
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
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
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
  const [hourlyRuns, setHourlyRuns] = useState(50);
  const [dailyRuns, setDailyRuns] = useState(500);
  const [containerHourly, setContainerHourly] = useState(10);
  const [anonymousHourly, setAnonymousHourly] = useState(10);
  const [requiredOrgSlug, setRequiredOrgSlug] = useState("");
  const [requiredSkillSlug, setRequiredSkillSlug] = useState("");

  const { data: policyData } = useQuery({
    queryKey: ["publish-policy", orgId],
    queryFn: () =>
      api<{ publishPolicy: PublishPolicy }>(`/v1/orgs/${orgId}/publish-policy`),
  });

  const { data: executionData } = useQuery({
    queryKey: ["execution-policy", orgId],
    queryFn: () =>
      api<{ executionPolicy: ExecutionPolicy }>(
        `/v1/orgs/${orgId}/execution-policy`,
      ),
  });

  const { data: auditData } = useQuery({
    queryKey: ["audit", orgId],
    queryFn: () =>
      api<{ items: AuditEvent[] }>(`/v1/orgs/${orgId}/audit?limit=20`),
  });

  const { data: telemetryData } = useQuery({
    queryKey: ["telemetry", orgId],
    queryFn: () =>
      api<{
        events: number;
        installs: number;
        activations: number;
        bySkill: { skillSlug: string; installCount: number; activationCount: number }[];
      }>(`/v1/orgs/${orgId}/telemetry`),
  });

  const { data: requiredData } = useQuery({
    queryKey: ["required-skills", orgId],
    queryFn: () =>
      api<{ items: { id: string; orgSlug: string; skillSlug: string }[] }>(
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
    }
  }, [executionData]);

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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["publish-policy", orgId] }),
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
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["execution-policy", orgId] }),
  });

  const addRequired = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/required-skills`, {
        method: "POST",
        body: JSON.stringify({
          orgSlug: requiredOrgSlug,
          skillSlug: requiredSkillSlug,
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["required-skills", orgId] }),
  });

  return (
    <div className="space-y-4">
      <Card id="governance">
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requirePass}
              onChange={(e) => setRequirePass(e.target.checked)}
            />
            Require security pass (no advisories or failures)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={blockAdvisory}
              onChange={(e) => setBlockAdvisory(e.target.checked)}
            />
            Block publish on security advisories
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requireEval}
              onChange={(e) => setRequireEval(e.target.checked)}
            />
            Require completed eval before publish
          </label>
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

      <Card>
        <CardHeader>
          <CardTitle>Execution quotas</CardTitle>
          <CardDescription>
            Limit hosted script runs per organization
          </CardDescription>
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
          <Button
            onClick={() => saveExecutionPolicy.mutate()}
            disabled={saveExecutionPolicy.isPending}
          >
            Save quotas
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Required skills</CardTitle>
          <CardDescription>
            Skills every project in this org should install
          </CardDescription>
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
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <span>
                {item.orgSlug}/{item.skillSlug}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeRequired.mutate(item.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telemetry funnel</CardTitle>
          <CardDescription>Published → installed → activated (last 30 days)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{telemetryData?.events ?? 0} events recorded</p>
          <p>
            {telemetryData?.installs ?? 0} installs ·{" "}
            {telemetryData?.activations ?? 0} activations
          </p>
          {telemetryData?.bySkill?.map((s) => (
            <div key={s.skillSlug} className="flex justify-between rounded border px-2 py-1">
              <span>{s.skillSlug}</span>
              <span className="text-muted-foreground">
                {s.installCount} / {s.activationCount}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Recent governance and publish events</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {auditData?.items?.length ? (
            auditData.items.map((e) => (
              <div key={e.id} className="rounded border px-2 py-1">
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
