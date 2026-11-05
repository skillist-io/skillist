import {
  api,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type Coverage,
  type FailurePattern,
  Input,
  type ObservabilitySummary,
  type Org,
  PageTitle,
  QueryError,
  Skeleton,
  type Skill,
} from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { CreateOrgForm } from "@/components/create-org-form";
import { useActiveOrg } from "@/lib/active-org";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => requireAuth(),
  component: DashboardPage,
});

const MAX_FAILURES_SHOWN = 5;

function DashboardPage() {
  const { activeOrg, isPending } = useActiveOrg();

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6" aria-hidden>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!activeOrg) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <PageTitle>Dashboard</PageTitle>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Create your first organization</CardTitle>
            <CardDescription>
              An organization is the namespace your skills publish under.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrgForm />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Keyed so the add-skill field doesn't carry over when the org changes.
  return <OrgOverview key={activeOrg.id} org={activeOrg} />;
}

function OrgOverview({ org }: { org: Org }) {
  const {
    data: skills,
    isPending: skillsPending,
    isError: skillsError,
    refetch: refetchSkills,
  } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
    // Drafts also arrive from the CLI and teammates, and this page says outright
    // when nothing needs you, so it can't rely on the default five-minute cache.
    refetchOnMount: "always",
  });

  // These three share their keys with Observability and Coverage. They may be
  // refused for some roles, so a failure narrows what this page can claim
  // rather than taking the page down.
  const failures = useQuery({
    queryKey: ["failure-patterns", org.id, "open"],
    queryFn: () =>
      api<{ patterns: FailurePattern[] }>(`/v1/orgs/${org.id}/failure-patterns?status=open`),
    retry: false,
  });
  const coverage = useQuery({
    queryKey: ["coverage", org.id],
    queryFn: () => api<Coverage>(`/v1/orgs/${org.id}/coverage`),
    retry: false,
  });
  const observability = useQuery({
    queryKey: ["observability", org.id, 30],
    queryFn: () => api<ObservabilitySummary>(`/v1/orgs/${org.id}/observability?days=30`),
    retry: false,
  });

  const usageByRepo = useMemo(
    () => new Map(observability.data?.telemetry.bySkill.map((row) => [row.skillRepo, row])),
    [observability.data],
  );
  const openFailuresByRepo = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pattern of failures.data?.patterns ?? []) {
      counts.set(pattern.skillRepo, (counts.get(pattern.skillRepo) ?? 0) + 1);
    }
    return counts;
  }, [failures.data]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div className="space-y-1">
        <PageTitle>{org.name}</PageTitle>
        <p className="text-sm text-muted-foreground">
          What needs you, and the state of every skill in this organization.
        </p>
      </div>

      <NeedsYou
        org={org}
        skills={skills}
        patterns={failures.data?.patterns}
        coverage={coverage.data}
        incomplete={failures.isError || coverage.isError}
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>Usage covers the last 30 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddSkill orgId={org.id} />
          {skillsError ? (
            <QueryError title="Could not load skills" onRetry={() => void refetchSkills()} />
          ) : skillsPending ? (
            <Skeleton className="h-32 w-full" />
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No skills yet. Add one above to open it in the editor.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Skill
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Live
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Draft
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Visibility
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Installs
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Activations
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Open failures
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => {
                    const usage = usageByRepo.get(skill.repo);
                    const openFailures = openFailuresByRepo.get(skill.repo) ?? 0;
                    return (
                      <tr key={skill.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4">
                          <Link
                            to="/orgs/$orgId/skills/$repo"
                            params={{ orgId: org.id, repo: skill.repo }}
                            className="font-medium text-foreground hover:underline"
                          >
                            {skill.repo}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {skill.publishedSemver ? `v${skill.publishedSemver}` : "none"}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {skill.draftSemver ? `v${skill.draftSemver}` : "none"}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{skill.visibility}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums">
                          {usage?.installCount ?? 0}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums">
                          {usage?.activationCount ?? 0}
                        </td>
                        <td
                          className={`py-2 text-right font-mono text-xs tabular-nums ${
                            openFailures > 0 ? "text-destructive" : ""
                          }`}
                        >
                          {openFailures}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Attention = { key: string; text: string; detail?: string; link: React.ReactNode };

function NeedsYou({
  org,
  skills,
  patterns,
  coverage,
  incomplete,
}: {
  org: Org;
  skills: Skill[] | undefined;
  patterns: FailurePattern[] | undefined;
  coverage: Coverage | undefined;
  incomplete: boolean;
}) {
  const items: Attention[] = [];

  for (const skill of skills ?? []) {
    if (!skill.draftSemver) continue;
    items.push({
      key: `draft-${skill.id}`,
      text: `${skill.repo} has an unpublished draft`,
      detail: `v${skill.draftSemver}`,
      link: (
        <Link
          to="/orgs/$orgId/skills/$repo"
          params={{ orgId: org.id, repo: skill.repo }}
          aria-label={`Open ${skill.repo}`}
        >
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ),
    });
  }

  for (const pattern of (patterns ?? []).slice(0, MAX_FAILURES_SHOWN)) {
    items.push({
      key: `failure-${pattern.id}`,
      text: `${pattern.skillRepo}: ${pattern.summary}`,
      detail: `${pattern.occurrences}×`,
      link: (
        <Link to="/observability" aria-label="Open failures in Observability">
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ),
    });
  }

  const uncovered = coverage ? coverage.summary.required - coverage.summary.covered : 0;
  if (uncovered > 0 || (coverage?.summary.drifted ?? 0) > 0) {
    const parts = [
      uncovered > 0 && `${uncovered} required ${uncovered === 1 ? "skill" : "skills"} not covered`,
      coverage?.summary.drifted && `${coverage.summary.drifted} drifted`,
    ].filter(Boolean);
    items.push({
      key: "coverage",
      text: parts.join(", "),
      link: (
        <Link to="/coverage" aria-label="Open Coverage">
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ),
    });
  }

  return (
    <section aria-labelledby="needs-you" className="space-y-3">
      <h2 id="needs-you" className="font-heading text-lg leading-snug font-semibold">
        Needs you
      </h2>
      {items.length > 0 ? (
        <ul className="divide-y divide-border border border-border bg-card">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">{item.text}</span>
              {item.detail && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {item.detail}
                </span>
              )}
              <Button variant="ghost" size="icon" asChild>
                {item.link}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {incomplete
            ? "No unpublished drafts. Failures and coverage couldn't be checked for your role."
            : "Nothing right now. Every draft is published, and there are no open failures or coverage gaps."}
        </p>
      )}
    </section>
  );
}

function AddSkill({ orgId }: { orgId: string }) {
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const createSkill = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills`, {
        method: "POST",
        body: JSON.stringify({ repo, visibility: "private" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", orgId] });
      setError(null);
      // Land directly in the bundle editor with the template already
      // scaffolded, instead of leaving the author to find the new skill
      // in the list and click into it themselves.
      navigate({ to: "/orgs/$orgId/skills/$repo", params: { orgId, repo } });
      setRepo("");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    },
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        createSkill.mutate();
      }}
    >
      <div className="flex max-w-md gap-2">
        <Input
          aria-label="New skill name"
          placeholder="new-skill-repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <Button type="submit" disabled={!repo || createSkill.isPending}>
          Add skill
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
