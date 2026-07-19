import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageTitle } from "@/components/ui/page-title";
import { api, type Org, type Skill } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => requireAuth(),
  component: DashboardPage,
});

function DashboardPage() {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const queryClient = useQueryClient();

  const {
    data: orgs,
    isError: orgsError,
    refetch: refetchOrgs,
  } = useQuery({
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
    <div className="mx-auto w-full max-w-6xl space-y-10">
      <div className="space-y-1">
        <PageTitle>Dashboard</PageTitle>
        <p className="text-sm text-muted-foreground">Manage organizations and skills.</p>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Create organization</CardTitle>
          <CardDescription>
            Group and govern related skills under a shared namespace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              placeholder="Acme Inc"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              placeholder="acme"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
            />
          </div>
          <Button
            onClick={() => createOrg.mutate()}
            disabled={!orgName || !orgSlug || createOrg.isPending}
          >
            {createOrg.isPending ? "Creating…" : "Create"}
          </Button>
        </CardContent>
      </Card>

      {orgsError ? <QueryError onRetry={() => void refetchOrgs()} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {orgs?.map((org) => (
          <OrgCard key={org.id} org={org} />
        ))}
      </div>
    </div>
  );
}

function OrgCard({ org }: { org: Org }) {
  const [repo, setRepo] = useState("");
  const [createSkillError, setCreateSkillError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: skills,
    isError: skillsError,
    refetch: refetchSkills,
  } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
  });

  const createSkill = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${org.id}/skills`, {
        method: "POST",
        body: JSON.stringify({ repo, visibility: "private" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", org.id] });
      setCreateSkillError(null);
      // Land directly in the bundle editor with the template already
      // scaffolded, instead of leaving the author to find the new skill
      // in the list and click into it themselves.
      navigate({ to: "/orgs/$orgId/skills/$repo", params: { orgId: org.id, repo } });
      setRepo("");
    },
    onError: (err) => {
      setCreateSkillError(err instanceof Error ? err.message : "Failed to create skill");
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
    <Card size="sm" className="flex flex-col">
      <CardHeader>
        <CardTitle>{org.name}</CardTitle>
        <CardDescription>
          {org.slug} · <Badge>{org.role}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="new-skill-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <Button
            onClick={() => {
              setCreateSkillError(null);
              createSkill.mutate();
            }}
            disabled={!repo || createSkill.isPending}
          >
            Add skill
          </Button>
        </div>
        {createSkillError ? <p className="text-sm text-destructive">{createSkillError}</p> : null}
        {skillsError ? (
          <QueryError title="Could not load skills" onRetry={() => void refetchSkills()} />
        ) : null}
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
              <NativeSelect
                aria-label="Member role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </NativeSelect>
              <Button
                variant="outline"
                onClick={() => inviteMember.mutate()}
                disabled={!inviteEmail || inviteMember.isPending}
              >
                Invite
              </Button>
            </div>
            {inviteMessage && <p className="text-sm text-muted-foreground">{inviteMessage}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
