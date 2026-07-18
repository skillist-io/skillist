import { objectToBundle, validateSkillBundle } from "@skillist/skill-format";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackInbox } from "@/components/feedback-inbox";
import { ScoreReadout } from "@/components/score-readout";
import type { CodeEditorHandle } from "@/components/skill-editor/code-editor";
import { errorLinesForSkillMd } from "@/components/skill-editor/frontmatter-lines";
import { SkillBundleEditor } from "@/components/skill-editor/skill-bundle-editor";
import { useSkillBundle } from "@/components/skill-editor/use-skill-bundle";
import { ValidationPanel } from "@/components/skill-editor/validation-panel";
import { SkillEvalPanel } from "@/components/skill-eval-panel";
import { SkillEvalRegression } from "@/components/skill-eval-regression";
import { SkillRunCard } from "@/components/skill-run-card";
import { SkillRunHistory } from "@/components/skill-run-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import {
  api,
  type Org,
  type PublishPolicy,
  type ReviewPreview,
  type SkillEval,
  type SkillVersion,
} from "@/lib/api";
import { diffLines, diffStats } from "@/lib/diff";
import { requireAuth } from "@/lib/require-auth";

type SemverBump = "patch" | "minor" | "major";

function previewNextSemver(base: string | undefined, bump: SemverBump): string {
  if (!base) return "0.1.0";
  const [major = 0, minor = 0, patch = 0] = base.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Shared between the loader (prefetch) and the component (render) so both
// sides hit the exact same cache entry.
const orgsQueryOptions = () => ({
  queryKey: ["orgs"] as const,
  queryFn: () => api<Org[]>("/v1/orgs"),
});

const versionsQueryOptions = (orgId: string, repo: string) => ({
  queryKey: ["versions", orgId, repo] as const,
  queryFn: () => api<SkillVersion[]>(`/v1/orgs/${orgId}/skills/${repo}/versions`),
});

const filesQueryOptions = (orgId: string, repo: string, versionId: string) => ({
  queryKey: ["files", orgId, repo, versionId] as const,
  queryFn: () =>
    api<{ files: Record<string, string> }>(
      `/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/files`,
    ),
});

export const Route = createFileRoute("/orgs/$orgId/skills/$repo")({
  beforeLoad: () => requireAuth(),
  loader: async ({ params: { orgId, repo }, context: { queryClient } }) => {
    const [, versions] = await Promise.all([
      queryClient.ensureQueryData(orgsQueryOptions()),
      queryClient.ensureQueryData(versionsQueryOptions(orgId, repo)),
    ]);
    const latestDraft = versions.find((v) => v.status === "draft") ?? versions[0];
    if (latestDraft) {
      await queryClient.ensureQueryData(filesQueryOptions(orgId, repo, latestDraft.id));
    }
  },
  pendingComponent: EditorSkeleton,
  component: SkillEditorPage,
});

function EditorSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <p className="sr-only" role="status">
        Loading skill editor
      </p>
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function SkillEditorPage() {
  const { orgId, repo } = Route.useParams();
  const queryClient = useQueryClient();
  const [feedbackBody, setFeedbackBody] = useState("");
  const [versionBump, setVersionBump] = useState<SemverBump>("patch");
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const { data: orgs } = useQuery(orgsQueryOptions());
  const orgSlug = orgs?.find((o) => o.id === orgId)?.slug ?? "";
  const { connected, lastEvent } = useSkillRealtime(orgSlug, repo);

  const { data: versions } = useQuery({
    ...versionsQueryOptions(orgId, repo),
    placeholderData: keepPreviousData,
  });

  const latestDraft = versions?.find((v) => v.status === "draft") ?? versions?.[0];
  const publishedVersion = versions?.find((v) => v.status === "published");

  const { data: scriptsData } = useQuery({
    queryKey: ["scripts", orgSlug, repo],
    queryFn: () => api<{ runtime: string; scripts: string[] }>(`/${orgSlug}/${repo}/scripts`),
    enabled: !!orgSlug && !!publishedVersion,
  });

  const { data: preview } = useQuery({
    queryKey: ["preview", orgId, repo, latestDraft?.id],
    queryFn: () =>
      api<ReviewPreview>(`/v1/orgs/${orgId}/skills/${repo}/versions/${latestDraft!.id}/preview`),
    enabled: !!latestDraft,
    placeholderData: keepPreviousData,
  });

  const { data: evals } = useQuery({
    queryKey: ["evals", orgId, repo],
    queryFn: () => api<{ items: SkillEval[] }>(`/v1/orgs/${orgId}/skills/${repo}/evals`),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const pending = items.some(
        (ev) =>
          ev.versionId === latestDraft?.id && (ev.status === "queued" || ev.status === "running"),
      );
      return pending ? 3000 : false;
    },
  });

  const { data: publishPolicyData } = useQuery({
    queryKey: ["publish-policy", orgId],
    queryFn: () => api<{ publishPolicy: PublishPolicy }>(`/v1/orgs/${orgId}/publish-policy`),
  });

  const publishPolicy = publishPolicyData?.publishPolicy;
  const draftEval = evals?.items?.find((ev) => ev.versionId === latestDraft?.id);
  const evalGateRequired = Boolean(
    publishPolicy?.requireEval || publishPolicy?.minEvalUplift != null,
  );
  const publishBlockedReason = useMemo(() => {
    if (!latestDraft || !evalGateRequired) return null;
    if (!draftEval || draftEval.status === "failed") {
      return "Save draft to queue an eval, then publish when complete.";
    }
    if (draftEval.status === "queued" || draftEval.status === "running") {
      return "Eval in progress — publish unlocks when complete.";
    }
    if (publishPolicy?.requireEval && draftEval.status !== "completed") {
      return "A completed eval is required before publish.";
    }
    if (
      publishPolicy?.minEvalUplift != null &&
      (draftEval.uplift == null || draftEval.uplift < publishPolicy.minEvalUplift)
    ) {
      return `Eval uplift +${draftEval.uplift ?? 0} is below minimum +${publishPolicy.minEvalUplift}.`;
    }
    return null;
  }, [latestDraft, evalGateRequired, draftEval, publishPolicy]);

  const { data: files } = useQuery({
    ...filesQueryOptions(orgId, repo, latestDraft?.id ?? ""),
    enabled: !!latestDraft,
  });

  const { data: compareFiles } = useQuery({
    queryKey: ["files", orgId, repo, compareVersionId],
    queryFn: () =>
      api<{ files: Record<string, string> }>(
        `/v1/orgs/${orgId}/skills/${repo}/versions/${compareVersionId!}/files`,
      ),
    enabled: !!compareVersionId,
  });

  const bundle = useSkillBundle({
    initialFiles: files?.files,
    versionId: latestDraft?.id,
  });
  const content = bundle.files["SKILL.md"] ?? "";
  const { overwriteSkillMd, reset: resetBundle } = bundle;
  const editorRef = useRef<CodeEditorHandle>(null);

  // Deferred so validation lags a beat behind fast typing instead of blocking it.
  const deferredFiles = useDeferredValue(bundle.files);
  const specErrors = useMemo(() => {
    if (Object.keys(deferredFiles).length === 0) return [];
    const result = validateSkillBundle(objectToBundle(deferredFiles), repo);
    return result.valid ? [] : result.errors;
  }, [deferredFiles, repo]);
  const errorLines = useMemo(
    () => errorLinesForSkillMd(deferredFiles["SKILL.md"] ?? "", specErrors),
    [deferredFiles, specErrors],
  );

  useBlocker({
    shouldBlockFn: () => {
      if (!bundle.dirty) return false;
      return !window.confirm("You have unsaved changes. Discard them and leave?");
    },
    // The bundle hook manages its own dirty-gated beforeunload; the router's
    // default would warn on every hard navigation even with no edits.
    enableBeforeUnload: false,
  });

  const diff = useMemo(() => {
    if (!compareVersionId || !compareFiles?.files["SKILL.md"]) return null;
    return diffLines(compareFiles.files["SKILL.md"], content);
  }, [compareVersionId, compareFiles, content]);

  const stats = diff ? diffStats(diff) : null;

  useEffect(() => {
    if (lastEvent?.skillMd) {
      overwriteSkillMd(lastEvent.skillMd);
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
    }
  }, [lastEvent, orgId, repo, queryClient, overwriteSkillMd]);

  const saveVersion = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions`, {
        method: "PUT",
        body: JSON.stringify({
          files: bundle.files,
          parentVersionId: latestDraft?.id,
          bump: versionBump,
        }),
      }),
    onSuccess: () => {
      resetBundle(bundle.files);
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["evals", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["files", orgId, repo] });
    },
  });

  // Cmd/Ctrl+S saves the draft instead of triggering the browser's save-page
  // dialog. Guarded exactly like the Save button: no-op while pending, dirty
  // is not required (mirrors clicking Save at any time), spec errors block it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (saveVersion.isPending || specErrors.length > 0) return;
      saveVersion.mutate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveVersion, specErrors.length]);

  const runEval = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${latestDraft!.id}/eval`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evals", orgId, repo] }),
  });

  const publish = useMutation({
    mutationFn: (versionId: string) =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/publish`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["evals", orgId, repo] });
    },
  });

  const rollback = useMutation({
    mutationFn: (versionId: string) =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/rollback`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] }),
  });

  const setPublic = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "public" }),
      }),
  });

  const submitFeedback = useMutation({
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          targetVersionId: latestDraft!.id,
          body: feedbackBody,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback", orgId, repo] });
      setFeedbackBody("");
    },
  });

  const approveFeedback = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/feedback/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ triggerAi: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feedback", orgId, repo] }),
  });

  const nextDraftSemver = previewNextSemver(
    latestDraft?.semver ?? publishedVersion?.semver,
    versionBump,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <PageTitle>{repo}</PageTitle>
          <p className="text-sm text-muted-foreground">
            {connected ? "Realtime connected" : "Realtime disconnected"}
            {latestDraft ? ` · draft v${latestDraft.semver}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="version-bump" className="text-xs">
              Next version
            </Label>
            <NativeSelect
              id="version-bump"
              value={versionBump}
              onChange={(e) => setVersionBump(e.target.value as SemverBump)}
            >
              <option value="patch">
                Patch → v
                {previewNextSemver(latestDraft?.semver ?? publishedVersion?.semver, "patch")}
              </option>
              <option value="minor">
                Minor → v
                {previewNextSemver(latestDraft?.semver ?? publishedVersion?.semver, "minor")}
              </option>
              <option value="major">
                Major → v
                {previewNextSemver(latestDraft?.semver ?? publishedVersion?.semver, "major")}
              </option>
            </NativeSelect>
          </div>
          <Button variant="outline" onClick={() => setPublic.mutate()}>
            Make public
          </Button>
          <Button
            onClick={() => saveVersion.mutate()}
            disabled={saveVersion.isPending || specErrors.length > 0}
            title={
              specErrors.length > 0
                ? `${specErrors.length} spec error${specErrors.length === 1 ? "" : "s"} — see the validation panel`
                : undefined
            }
          >
            Save v{nextDraftSemver}
          </Button>
          {latestDraft && (
            <Button
              onClick={() => publish.mutate(latestDraft.id)}
              disabled={publish.isPending || Boolean(publishBlockedReason)}
              title={publishBlockedReason ?? undefined}
            >
              Publish
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link to="/dashboard">Back</Link>
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Skill bundle editor</CardTitle>
            <CardDescription>
              agentskills.io format — SKILL.md frontmatter, scripts/, references/, assets/
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SkillBundleEditor
              bundle={bundle}
              repoSlug={repo}
              validationErrors={specErrors}
              errorLines={errorLines}
              editorRef={editorRef}
            />
          </CardContent>
        </Card>

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Spec validation</CardTitle>
              <CardDescription>agentskills.io conformance, checked as you type</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ValidationPanel
                errors={specErrors}
                onFocusError={(error) => {
                  bundle.setActivePath("SKILL.md");
                  const lines = errorLinesForSkillMd(content, [error]);
                  const line = lines.values().next().value ?? 1;
                  requestAnimationFrame(() => editorRef.current?.focusLine(line));
                }}
              />
            </CardContent>
          </Card>
          {publishBlockedReason && (
            <Card className="flex flex-col">
              <CardContent className="pt-4 text-sm">
                <span className="font-medium">Publish gated by eval policy.</span>{" "}
                <span className="text-muted-foreground">{publishBlockedReason}</span>
              </CardContent>
            </Card>
          )}

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Quality review</CardTitle>
              <CardDescription>
                Rubric scores before publish
                {publishedVersion?.qualityScore != null && " · last published below"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScoreReadout
                quality={preview?.qualityScore ?? publishedVersion?.qualityScore}
                impact={preview?.impactScore ?? publishedVersion?.impactScore}
                security={preview?.securityStatus ?? publishedVersion?.securityStatus}
              />
              {preview?.reviewChecks?.map((check) => (
                <div
                  key={check.id}
                  className={`border px-2 py-1 text-xs ${
                    check.passed ? "border-border" : "border-destructive/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {check.passed ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <X className="size-3.5 text-destructive" aria-hidden />
                    )}
                    {check.label}
                  </span>
                  <p className="text-muted-foreground">{check.message}</p>
                </div>
              ))}
              {preview?.securityIssues?.map((issue) => (
                <div
                  key={`${issue.severity}-${issue.path}-${issue.message}`}
                  className="border border-destructive/40 px-2 py-1 text-xs"
                >
                  <span className="font-medium text-destructive uppercase">{issue.severity}</span>{" "}
                  {issue.path}: {issue.message}
                </div>
              ))}
            </CardContent>
          </Card>

          {(scriptsData?.scripts?.length ?? 0) > 0 && orgSlug && (
            <SkillRunCard org={orgSlug} repo={repo} scripts={scriptsData!.scripts} />
          )}

          {orgSlug && publishedVersion && <SkillRunHistory org={orgSlug} repo={repo} />}

          <SkillEvalPanel
            orgId={orgId}
            repo={repo}
            versionId={latestDraft?.id}
            onRunEval={() => runEval.mutate()}
            isRunning={runEval.isPending}
          />

          <SkillEvalRegression evals={evals?.items ?? []} />

          <Card className="flex flex-col">
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
                      compareVersionId === v.id ? "font-semibold text-primary" : ""
                    }`}
                    onClick={() => setCompareVersionId(compareVersionId === v.id ? null : v.id)}
                  >
                    v{v.semver}
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge>{v.status}</Badge>
                    {(v.status === "published" || v.status === "archived") &&
                      v.id !== publishedVersion?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rollback.mutate(v.id)}
                          disabled={rollback.isPending}
                        >
                          Rollback
                        </Button>
                      )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {diff && stats && (
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Version diff</CardTitle>
                <CardDescription>
                  +{stats.added} / −{stats.removed} lines vs selected version
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-64 overflow-auto border border-border bg-muted p-2 font-mono text-xs">
                  {diff.map((line) => (
                    <div
                      key={`${line.type}-${line.line}`}
                      className={
                        line.type === "add"
                          ? "bg-foreground/[0.06] text-foreground"
                          : line.type === "remove"
                            ? "bg-destructive/10 text-destructive"
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

          <FeedbackInbox
            orgId={orgId}
            repo={repo}
            latestDraftId={latestDraft?.id}
            editorContent={content}
            feedbackBody={feedbackBody}
            onFeedbackBodyChange={setFeedbackBody}
            onSubmit={() => submitFeedback.mutate()}
            onApprove={(id) => approveFeedback.mutate(id)}
            onApplyDraft={(skillMd) => overwriteSkillMd(skillMd)}
            onPublishDraft={(versionId) => publish.mutate(versionId)}
            isSubmitting={submitFeedback.isPending}
            isApproving={approveFeedback.isPending}
            isPublishing={publish.isPending}
          />
        </div>
      </div>
    </div>
  );
}
