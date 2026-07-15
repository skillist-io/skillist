import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api, type Org } from "@/lib/api";
import { apiUrl } from "@/lib/api-url";
import { oauthRedirectUris } from "@skillist/auth";
import { requireAuth } from "@/lib/require-auth";

const API_SCOPES = [
  "skills:read",
  "skills:write",
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
              {activeOrgId && <ApiKeyManager orgId={activeOrgId} />}
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
