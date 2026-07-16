import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Org, type SkillInventoryItem } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLE_SCAN = `{
  "items": [
    {
      "repoFullName": "skillist/cloudflare-deploy",
      "filePath": ".cursor/skills/cloudflare-deploy/SKILL.md",
      "localSlug": "cloudflare-deploy"
    },
    {
      "repoFullName": "acme/web-app",
      "filePath": ".claude/skills/review/SKILL.md",
      "localSlug": "review",
      "registryOrgSlug": "skillist",
      "registryRepo": "sql-review"
    }
  ]
}`;

export const Route = createFileRoute("/inventory")({
  beforeLoad: () => requireAuth(),
  component: InventoryPage,
});

function InventoryPage() {
  const queryClient = useQueryClient();
  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [scanJson, setScanJson] = useState("");
  const activeOrgId = selectedOrgId || orgs?.[0]?.id || "";
  const activeOrg = orgs?.find((o) => o.id === activeOrgId);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", activeOrgId],
    queryFn: () =>
      api<{ items: SkillInventoryItem[] }>(`/v1/orgs/${activeOrgId}/inventory`),
    enabled: !!activeOrgId,
  });

  const scan = useMutation({
    mutationFn: (payload: { items: SkillInventoryItem[] }) =>
      api<{ upserted: number }>(`/v1/orgs/${activeOrgId}/inventory/scan`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", activeOrgId] });
      setScanJson("");
    },
  });

  const items = data?.items ?? [];
  const managed = items.filter((i) => i.managed).length;
  const unmanaged = items.length - managed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Skill inventory</h1>
        <p className="text-muted-foreground">
          Skills discovered across repos — managed registry links vs local-only
        </p>
      </div>

      {orgs && orgs.length > 1 && (
        <div className="max-w-xs">
          <Label htmlFor="inventory-org">Organization</Label>
          <select
            id="inventory-org"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={activeOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total discovered</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{items.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Registry-managed</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{managed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Local only</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{unmanaged}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scan results</CardTitle>
          <CardDescription>
            POST skill paths from CI or a local scanner for {activeOrg?.slug ?? "your org"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            className="min-h-[140px] font-mono text-xs"
            placeholder='{ "items": [{ "repoFullName": "org/repo", "filePath": ".cursor/skills/foo/SKILL.md" }] }'
            value={scanJson}
            onChange={(e) => setScanJson(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!scanJson.trim() || !activeOrgId || scan.isPending}
              onClick={() => {
                try {
                  const parsed = JSON.parse(scanJson) as { items: SkillInventoryItem[] };
                  scan.mutate(parsed);
                } catch {
                  alert("Invalid JSON — check the scan payload format.");
                }
              }}
            >
              {scan.isPending ? "Scanning…" : "Submit scan"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setScanJson(EXAMPLE_SCAN)}
            >
              Load example
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovered skills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading ? (
            <p className="text-muted-foreground">Loading inventory…</p>
          ) : items.length ? (
            items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.repoFullName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {item.filePath}
                  </p>
                  {item.localSlug && (
                    <p className="text-xs text-muted-foreground">local: {item.localSlug}</p>
                  )}
                  {item.managed && item.registryOrgSlug && item.registryRepo && (
                    <p className="text-xs text-muted-foreground">
                      → skillist.dev/{item.registryOrgSlug}/{item.registryRepo}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={item.managed ? "default" : "secondary"}>
                    {item.managed ? "managed" : "local"}
                  </Badge>
                  {item.registryOrgSlug && item.registryRepo && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/$org/$repo"
                        params={{
                          org: item.registryOrgSlug,
                          repo: item.registryRepo,
                        }}
                      >
                        {item.registryOrgSlug}/{item.registryRepo}
                      </Link>
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.scannedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">
              No skills scanned yet. Submit a scan payload or run{" "}
              <code className="rounded bg-muted px-1">skillist inventory scan</code> from CI.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
