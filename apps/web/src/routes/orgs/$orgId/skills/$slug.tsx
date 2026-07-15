import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SkillVersion, type Feedback, type Org, type ReviewPreview, type SkillEval } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";
import { diffLines, diffStats } from "@/lib/diff";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScoreBadges } from "@/components/score-badges";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import { useState, useEffect, useMemo } from "react";

export const Route = createFileRoute("/orgs/$orgId/skills/$slug")({
  beforeLoad: () => requireAuth(),
  component: SkillEditorPage,
});

function SkillEditorPage() {
  const { orgId, slug } = Route.useParams();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const orgSlug = orgs?.find((o) => o.id === orgId)?.slug ?? "";
  const { connected, lastEvent } = useSkillRealtime(orgSlug, slug);

  const { data: versions } = useQuery({
    queryKey: ["versions", orgId, slug],
    queryFn: () =>
      api<SkillVersion[]>(`/v1/orgs/${orgId}/skills/${slug}/versions`),
  });

  const latestDraft = versions?.find((v) => v.status === "draft") ?? versions?.[0];
  const publishedVersion = versions?.find((v) => v.status === "published");

  const { data: preview } = useQuery({
    queryKey: ["preview", orgId, slug, latestDraft?.id],
    queryFn: () =>
      api<ReviewPreview>(
        `/v1/orgs/${orgId}/skills/${slug}/versions/${latestDraft!.id}/preview`,
      ),
    enabled: !!latestDraft,
  });

  const { data: evals } = useQuery({
    queryKey: ["evals", orgId, slug],
    queryFn: () =>
      api<{ items: SkillEval[] }>(`/v1/orgs/${orgId}/skills/${slug}/evals`),
  });

  const { data: files } = useQuery({
    queryKey: ["files", orgId, slug, latestDraft?.id],
    queryFn: () =>
      api<{ files: Record<string, string> }>(
        `/v1/orgs/${orgId}/skills/${slug}/versions/${latestDraft!.id}/files`,
      ),
    enabled: !!latestDraft,
  });

  const { data: compareFiles } = useQuery({
    queryKey: ["files", orgId, slug, compareVersionId],
    queryFn: () =>
      api<{ files: Record<string, string> }>(
        `/v1/orgs/${orgId}/skills/${slug}/versions/${compareVersionId!}/files`,
      ),
    enabled: !!compareVersionId,
  });

  const diff = useMemo(() => {
    if (!compareVersionId || !compareFiles?.files["SKILL.md"]) return null;
    return diffLines(compareFiles.files["SKILL.md"], content);
  }, [compareVersionId, compareFiles, content]);

  const stats = diff ? diffStats(diff) : null;

  useEffect(() => {
    if (files?.files["SKILL.md"]) {
      setContent(files.files["SKILL.md"]);
    }
  }, [files]);

  useEffect(() => {
    if (lastEvent?.skillMd) {
      setContent(lastEvent.skillMd);
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, slug] });
    }
  }, [lastEvent, orgId, slug, queryClient]);

  const saveVersion = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${slug}/versions`, {
        method: "PUT",
        body: JSON.stringify({
          files: { ...files?.files, "SKILL.md": content },
          parentVersionId: latestDraft?.id,
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, slug] }),
  });

  const runEval = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${slug}/versions/${latestDraft!.id}/eval`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["evals", orgId, slug] }),
  });

  const publish = useMutation({
    mutationFn: (versionId: string) =>
      api(`/v1/orgs/${orgId}/skills/${slug}/versions/${versionId}/publish`, {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, slug] }),
  });

  const setPublic = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${slug}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "public" }),
      }),
  });

  const { data: feedbackList } = useQuery({
    queryKey: ["feedback", orgId, slug],
    queryFn: () =>
      api<Feedback[]>(`/v1/orgs/${orgId}/skills/${slug}/feedback`),
  });

  const submitFeedback = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${slug}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          targetVersionId: latestDraft!.id,
          body: feedbackBody,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback", orgId, slug] });
      setFeedbackBody("");
    },
  });

  const approveFeedback = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/feedback/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ triggerAi: true }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["feedback", orgId, slug] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{slug}</h1>
          <p className="text-sm text-muted-foreground">
            {connected ? "Realtime connected" : "Realtime disconnected"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPublic.mutate()}>
            Make public
          </Button>
          {latestDraft && (
            <Button
              variant="outline"
              onClick={() => runEval.mutate()}
              disabled={runEval.isPending}
            >
              Run eval
            </Button>
          )}
          <Button onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending}>
            Save draft
          </Button>
          {latestDraft && (
            <Button
              onClick={() => publish.mutate(latestDraft.id)}
              disabled={publish.isPending}
            >
              Publish
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link to="/dashboard">Back</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>SKILL.md editor</CardTitle>
            <CardDescription>agentskills.io format with YAML frontmatter</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              className="min-h-[400px] font-mono text-xs"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quality review</CardTitle>
              <CardDescription>
                Rubric scores before publish
                {publishedVersion?.qualityScore != null && " · last published below"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScoreBadges
                quality={preview?.qualityScore ?? publishedVersion?.qualityScore}
                impact={preview?.impactScore ?? publishedVersion?.impactScore}
                security={preview?.securityStatus ?? publishedVersion?.securityStatus}
              />
              {preview?.reviewChecks?.map((check) => (
                <div
                  key={check.id}
                  className={`rounded border px-2 py-1 text-xs ${
                    check.passed ? "border-green-200" : "border-amber-200"
                  }`}
                >
                  <span className="font-medium">{check.label}</span>
                  <p className="text-muted-foreground">{check.message}</p>
                </div>
              ))}
              {preview?.securityIssues?.map((issue, i) => (
                <div key={i} className="rounded border border-red-200 px-2 py-1 text-xs">
                  <span className="font-medium">{issue.severity}</span> {issue.path}: {issue.message}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evals</CardTitle>
              <CardDescription>With-skill vs baseline uplift</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {evals?.items?.length ? (
                evals.items.map((ev) => (
                  <div key={ev.id} className="flex justify-between rounded border px-2 py-1">
                    <Badge>{ev.status}</Badge>
                    <span>
                      {ev.baselineScore != null && ev.withSkillScore != null
                        ? `${ev.baselineScore} → ${ev.withSkillScore} (+${ev.uplift ?? 0})`
                        : "Pending"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No eval runs yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
              <CardDescription>Compare a version against the current editor</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {versions?.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={`text-left hover:underline ${
                      compareVersionId === v.id
                        ? "font-semibold text-primary"
                        : ""
                    }`}
                    onClick={() =>
                      setCompareVersionId(compareVersionId === v.id ? null : v.id)
                    }
                  >
                    v{v.semver}
                  </button>
                  <Badge>{v.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {diff && stats && (
            <Card>
              <CardHeader>
                <CardTitle>Version diff</CardTitle>
                <CardDescription>
                  +{stats.added} / −{stats.removed} lines vs selected version
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-64 overflow-auto rounded border bg-muted p-2 font-mono text-xs">
                  {diff.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === "add"
                          ? "bg-green-100 text-green-900"
                          : line.type === "remove"
                            ? "bg-red-100 text-red-900"
                            : "text-muted-foreground"
                      }
                    >
                      {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                      {line.line}
                    </div>
                  ))}
                </pre>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Feedback inbox</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Submit feedback</Label>
                <Textarea
                  value={feedbackBody}
                  onChange={(e) => setFeedbackBody(e.target.value)}
                  placeholder="Suggest an improvement..."
                />
                <Button
                  className="mt-2"
                  size="sm"
                  onClick={() => submitFeedback.mutate()}
                  disabled={!feedbackBody || !latestDraft}
                >
                  Submit
                </Button>
              </div>
              {feedbackList?.map((f) => (
                <div key={f.id} className="rounded border p-3 text-sm">
                  <div className="mb-1 flex justify-between">
                    <Badge>{f.source}</Badge>
                    <Badge>{f.status}</Badge>
                  </div>
                  <p>{f.body}</p>
                  {f.status === "pending" && (
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => approveFeedback.mutate(f.id)}
                    >
                      Approve + AI suggest
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
