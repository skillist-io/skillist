import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Org, type Skill } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => requireAuth(),
  component: DashboardPage,
});

function DashboardPage() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const createOrg = useMutation({
    mutationFn: () =>
      api<Org>("/v1/orgs", {
        method: "POST",
        body: JSON.stringify({ name: orgName, slug: orgSlug }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setOrgName("");
      setOrgSlug("");
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Manage organizations and skills
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create organization</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div>
            <Label>Name</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} />
          </div>
          <Button
            className="self-end"
            onClick={() => createOrg.mutate()}
            disabled={!orgName || !orgSlug || createOrg.isPending}
          >
            Create
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {orgs?.map((org) => (
          <OrgCard key={org.id} org={org} />
        ))}
      </div>
    </div>
  );
}

function OrgCard({ org }: { org: Org }) {
  const [slug, setSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: skills } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
  });

  const createSkill = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${org.id}/skills`, {
        method: "POST",
        body: JSON.stringify({ slug, visibility: "private" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", org.id] });
      setSlug("");
    },
  });

  const inviteMember = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${org.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteMessage("Member invited.");
    },
    onError: (err) => {
      setInviteMessage(err instanceof Error ? err.message : "Invite failed");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{org.name}</CardTitle>
        <CardDescription>
          {org.slug} · <Badge>{org.role}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="new-skill-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <Button
            onClick={() => createSkill.mutate()}
            disabled={!slug || createSkill.isPending}
          >
            Add skill
          </Button>
        </div>
        <ul className="space-y-1 text-sm">
          {skills?.map((s) => (
            <li key={s.id}>
              <Link
                to="/orgs/$orgId/skills/$repo"
                params={{ orgId: org.id, repo: s.repo }}
                className="text-primary hover:underline"
              >
                {s.repo}
              </Link>{" "}
              <Badge className="ml-1">{s.visibility}</Badge>
            </li>
          ))}
        </ul>
        {org.role === "owner" && (
          <div className="space-y-2 border-t pt-3">
            <Label>Invite member</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="min-w-[200px] flex-1"
              />
              <select
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
              <Button
                variant="outline"
                onClick={() => inviteMember.mutate()}
                disabled={!inviteEmail || inviteMember.isPending}
              >
                Invite
              </Button>
            </div>
            {inviteMessage && (
              <p className="text-sm text-muted-foreground">{inviteMessage}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
