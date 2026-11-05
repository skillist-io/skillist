import { objectToBundle, validateSkillBundle } from "@skillist/skill-format";
import {
  api,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Label,
  NativeSelect,
  notify,
  type Org,
  PageTitle,
  type PublishPolicy,
  QueryError,
  type ReviewPreview,
  ScoreReadout,
  Skeleton,
  type Skill,
  type SkillEval,
  SkillRunCard,
  SkillRunHistory,
  type SkillVersion,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useSkillRealtime,
} from "@skillist/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AddToProjectButton } from "@/components/add-to-project";
import { FeedbackInbox } from "@/components/feedback-inbox";
import type { CodeEditorHandle } from "@/components/skill-editor/code-editor";
import { errorLinesForSkillMd } from "@/components/skill-editor/frontmatter-lines";
import { SkillBundleEditor } from "@/components/skill-editor/skill-bundle-editor";
import { useSkillBundle } from "@/components/skill-editor/use-skill-bundle";
import { ValidationPanel } from "@/components/skill-editor/validation-panel";
import { SkillEvalPanel } from "@/components/skill-eval-panel";
import { SkillEvalRegression } from "@/components/skill-eval-regression";
import { SkillStateStrip } from "@/components/skill-state-strip";
import { useSyncActiveOrgFromParam } from "@/lib/active-org";
import { diffLines, diffStats } from "@/lib/diff";
import { requireAuth } from "@/lib/require-auth";
import { resolveVersions } from "@/lib/skill-versions";

type SemverBump = "patch" | "minor" | "major";

const SKILL_TABS = ["edit", "evals", "versions", "runs", "feedback"] as const;
type SkillTab = (typeof SKILL_TABS)[number];

function isSkillTab(value: unknown): value is SkillTab {
  return SKILL_TABS.includes(value as SkillTab);
}

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
  // The tab lives in the URL so a link can open it and Back returns to it.
  validateSearch: (search: Record<string, unknown>): { tab?: SkillTab } =>
    isSkillTab(search.tab) && search.tab !== "edit" ? { tab: search.tab } : {},
  beforeLoad: () => requireAuth(),
  loader: async ({ params: { orgId, repo }, context: { queryClient } }) => {
    const [, versions] = await Promise.all([
      queryClient.ensureQueryData(orgsQueryOptions()),
      queryClient.ensureQueryData(versionsQueryOptions(orgId, repo)),
    ]);
    const { base } = resolveVersions(versions);
    if (base) {
      await queryClient.ensureQueryData(filesQueryOptions(orgId, repo, base.id));
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
  const { tab = "edit" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  useSyncActiveOrgFromParam(orgId);
  const queryClient = useQueryClient();
  const [feedbackBody, setFeedbackBody] = useState("");
  const [versionBump, setVersionBump] = useState<SemverBump>("patch");
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [publishTargetId, setPublishTargetId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<SkillVersion | null>(null);
  const [confirmVisibility, setConfirmVisibility] = useState(false);
  const { data: orgs } = useQuery(orgsQueryOptions());
  const orgSlug = orgs?.find((o) => o.id === orgId)?.slug ?? "";
  const { connected, lastEvent } = useSkillRealtime(orgSlug, repo);

  const { data: versions } = useQuery({
    ...versionsQueryOptions(orgId, repo),
    placeholderData: keepPreviousData,
  });

  // `latestDraft` is the version the editor builds on, which is the live one
  // when no draft exists. Only `draftVersion` means unpublished work, so use it
  // for anything that tells the reader what state the skill is in.
  const {
    ordered: orderedVersions,
    draft: draftVersion,
    base: latestDraft,
    published: publishedVersion,
    newest: newestVersion,
  } = useMemo(() => resolveVersions(versions), [versions]);

  // Same key as the sidebar, so this costs no extra request.
  const { data: orgSkills } = useQuery({
    queryKey: ["skills", orgId],
    queryFn: () => api<Skill[]>(`/v1/orgs/${orgId}/skills`),
  });
  const visibility = orgSkills?.find((s) => s.repo === repo)?.visibility;

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
  const evalBlockedReason = useMemo(() => {
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

  const {
    data: files,
    isError: filesFailed,
    refetch: refetchFiles,
  } = useQuery({
    ...filesQueryOptions(orgId, repo, latestDraft?.id ?? ""),
    enabled: !!latestDraft,
  });
  // Every saved version has at least SKILL.md, so empty files means the load
  // failed. Showing that as a blank document would read as lost content, and
  // saving over it would make the loss real.
  const filesUnavailable =
    !!latestDraft && (filesFailed || (!!files && Object.keys(files.files).length === 0));

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
  const specErrorSummary =
    specErrors.length > 0
      ? `${specErrors.length} spec error${specErrors.length === 1 ? "" : "s"} in the editor. Fix them on the Edit tab.`
      : null;
  const publishBlockedReason = filesUnavailable
    ? "This version's files didn't load."
    : (specErrorSummary ?? evalBlockedReason);
  const saveDisabled = specErrors.length > 0 || filesUnavailable;

  const leaveBlocker = useBlocker({
    // Switching tabs changes the URL but stays on this page, and the edits
    // survive it, so only leaving the page counts.
    shouldBlockFn: ({ current, next }) => bundle.dirty && current.pathname !== next.pathname,
    // The bundle hook manages its own dirty-gated beforeunload; the router's
    // default would warn on every hard navigation even with no edits.
    enableBeforeUnload: false,
    withResolver: true,
  });

  const diff = useMemo(() => {
    if (!compareVersionId || !compareFiles?.files["SKILL.md"]) return null;
    return diffLines(compareFiles.files["SKILL.md"], content);
  }, [compareVersionId, compareFiles, content]);

  const stats = diff ? diffStats(diff) : null;

  // A ref so the effect below fires on new events only, not on each keystroke.
  const dirtyRef = useRef(bundle.dirty);
  dirtyRef.current = bundle.dirty;

  useEffect(() => {
    if (!lastEvent?.skillMd) return;
    queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
    // A publish from elsewhere must never replace work in progress.
    if (dirtyRef.current) {
      notify("info", "A new version was published elsewhere. Your unsaved edits were kept.");
      return;
    }
    overwriteSkillMd(lastEvent.skillMd);
  }, [lastEvent, orgId, repo, queryClient, overwriteSkillMd]);

  const nextDraftSemver = previewNextSemver(newestVersion?.semver, versionBump);

  const saveVersion = useMutation({
    meta: { success: "Draft saved", failure: "Could not save the draft" },
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions`, {
        method: "PUT",
        body: JSON.stringify({
          files: bundle.files,
          parentVersionId: latestDraft?.id,
          // Pinned so the saved version is the one the button names. Bumping from
          // the parent would reuse a number after a rollback, which the API refuses.
          semver: nextDraftSemver,
        }),
      }),
    onSuccess: () => {
      resetBundle(bundle.files);
      queryClient.invalidateQueries({ queryKey: ["skills", orgId] });
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
      if (saveVersion.isPending || saveDisabled) return;
      saveVersion.mutate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveVersion, saveDisabled]);

  const runEval = useMutation({
    meta: { failure: "Could not start the eval" },
    mutationFn: () =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${latestDraft!.id}/eval`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evals", orgId, repo] }),
  });

  const publish = useMutation({
    meta: { failure: "Could not publish" },
    mutationFn: (versionId: string) =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/publish`, {
        method: "POST",
      }),
    onSuccess: (_data, versionId) => {
      const semver = versions?.find((v) => v.id === versionId)?.semver;
      notify("success", semver ? `v${semver} is live` : "Version published");
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["evals", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["skills", orgId] });
    },
    onSettled: () => setPublishTargetId(null),
  });

  const rollback = useMutation({
    meta: { failure: "Could not roll back" },
    mutationFn: (versionId: string) =>
      api(`/v1/orgs/${orgId}/skills/${repo}/versions/${versionId}/rollback`, {
        method: "POST",
      }),
    onSuccess: (_data, versionId) => {
      const semver = versions?.find((v) => v.id === versionId)?.semver;
      notify("success", semver ? `Rolled back. v${semver} is live` : "Rolled back");
      queryClient.invalidateQueries({ queryKey: ["versions", orgId, repo] });
      queryClient.invalidateQueries({ queryKey: ["skills", orgId] });
    },
    onSettled: () => setRollbackTarget(null),
  });

  const isPublic = visibility === "public";
  const changeVisibility = useMutation({
    meta: { failure: "Could not change visibility" },
    mutationFn: (next: "public" | "private") =>
      api(`/v1/orgs/${orgId}/skills/${repo}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      }),
    onSuccess: (_data, next) => {
      notify("success", `${repo} is now ${next}`);
      queryClient.invalidateQueries({ queryKey: ["skills", orgId] });
    },
    onSettled: () => setConfirmVisibility(false),
  });

  const submitFeedback = useMutation({
    meta: { success: "Feedback submitted", failure: "Could not submit feedback" },
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
    meta: { success: "Feedback approved", failure: "Could not approve feedback" },
    mutationFn: (id: string) =>
      api(`/v1/feedback/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ triggerAi: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feedback", orgId, repo] }),
  });

  const publishTarget = versions?.find((v) => v.id === publishTargetId);
  const scoresUsable = !filesUnavailable && specErrors.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>{repo}</PageTitle>
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
                Patch → v{previewNextSemver(newestVersion?.semver, "patch")}
              </option>
              <option value="minor">
                Minor → v{previewNextSemver(newestVersion?.semver, "minor")}
              </option>
              <option value="major">
                Major → v{previewNextSemver(newestVersion?.semver, "major")}
              </option>
            </NativeSelect>
          </div>
          {versions?.[0]?.skillId && (
            <AddToProjectButton
              target={{ kind: "skill", skillId: versions[0].skillId, label: repo }}
              variant="outline"
              size="default"
            />
          )}
          {visibility && (
            <Button variant="outline" onClick={() => setConfirmVisibility(true)}>
              {isPublic ? "Make private" : "Make public"}
            </Button>
          )}
          <Button
            variant={draftVersion ? "outline" : "default"}
            onClick={() => saveVersion.mutate()}
            disabled={saveVersion.isPending || saveDisabled}
          >
            {saveVersion.isPending ? "Saving…" : `Save draft v${nextDraftSemver}`}
          </Button>
          {draftVersion && (
            <Button
              onClick={() => setPublishTargetId(draftVersion.id)}
              disabled={publish.isPending || Boolean(publishBlockedReason)}
            >
              Publish v{draftVersion.semver}
            </Button>
          )}
        </div>
      </div>

      <SkillStateStrip
        liveSemver={publishedVersion?.semver}
        draftSemver={draftVersion?.semver}
        visibility={visibility}
        realtimeConnected={connected}
        publishBlockedReason={draftVersion ? publishBlockedReason : null}
      />

      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({
            search: next === "edit" ? {} : { tab: next as SkillTab },
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="evals">Evals</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-6">
          {filesUnavailable ? (
            <QueryError
              title="Could not load this version's files"
              message="Nothing has been lost. Editing is off until the files load, so a blank bundle can't be saved over this version."
              onRetry={() => void refetchFiles()}
            />
          ) : (
            <SkillBundleEditor
              bundle={bundle}
              repoSlug={repo}
              validationErrors={specErrors}
              errorLines={errorLines}
              editorRef={editorRef}
            />
          )}

          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Spec validation</CardTitle>
                <CardDescription>agentskills.io conformance, checked as you type</CardDescription>
              </CardHeader>
              {filesUnavailable ? (
                // Validating the empty stub would report errors in a bundle
                // that was never loaded.
                <CardContent className="text-sm text-muted-foreground">
                  Validation runs once the files load.
                </CardContent>
              ) : (
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
              )}
            </Card>

            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Quality review</CardTitle>
                <CardDescription>
                  Rubric scores before publish
                  {publishedVersion?.qualityScore != null && " · last published below"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {scoresUsable ? (
                  <>
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
                        <span className="font-medium text-destructive uppercase">
                          {issue.severity}
                        </span>{" "}
                        {issue.path}: {issue.message}
                      </div>
                    ))}
                  </>
                ) : (
                  // A score for a bundle that doesn't parse describes nothing,
                  // and a security PASS on it would be false reassurance.
                  <p className="text-sm text-muted-foreground">
                    Scores appear once the bundle passes spec validation.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="evals">
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <SkillEvalPanel
              orgId={orgId}
              repo={repo}
              versionId={latestDraft?.id}
              onRunEval={() => runEval.mutate()}
              isRunning={runEval.isPending}
            />
            <SkillEvalRegression evals={evals?.items ?? []} />
          </div>
        </TabsContent>

        <TabsContent value="versions">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Versions</CardTitle>
                <CardDescription>Compare a version against the current editor</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {orderedVersions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      aria-pressed={compareVersionId === v.id}
                      className={`text-left font-mono hover:underline ${
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
                            onClick={() => setRollbackTarget(v)}
                            disabled={rollback.isPending}
                          >
                            Roll back
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {diff && stats ? (
              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle>Version diff</CardTitle>
                  <CardDescription>
                    +{stats.added} / −{stats.removed} lines vs selected version
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto border border-border bg-muted p-2 font-mono text-xs">
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
            ) : (
              <p className="p-1 text-sm text-muted-foreground">
                Select a version to compare it with the editor.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs">
          {orgSlug && publishedVersion ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {(scriptsData?.scripts?.length ?? 0) > 0 && (
                <SkillRunCard org={orgSlug} repo={repo} scripts={scriptsData!.scripts} />
              )}
              <SkillRunHistory org={orgSlug} repo={repo} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Runs appear here once a version is published.
            </p>
          )}
        </TabsContent>

        <TabsContent value="feedback">
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
            onPublishDraft={(versionId) => setPublishTargetId(versionId)}
            isSubmitting={submitFeedback.isPending}
            isApproving={approveFeedback.isPending}
            isPublishing={publish.isPending}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={publishTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setPublishTargetId(null);
        }}
        title={`Publish v${publishTarget?.semver ?? ""}?`}
        description={
          <>
            {publishedVersion
              ? `This replaces v${publishedVersion.semver} as the live version.`
              : "This becomes the first live version."}{" "}
            Agents get it on their next pull.
            {bundle.dirty && " Unsaved edits aren't included. Save a draft first to publish them."}
          </>
        }
        confirmLabel="Publish"
        isPending={publish.isPending}
        onConfirm={() => {
          if (publishTargetId) publish.mutate(publishTargetId);
        }}
      />

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null);
        }}
        title={`Roll back to v${rollbackTarget?.semver ?? ""}?`}
        description={`This replaces ${
          publishedVersion ? `v${publishedVersion.semver}` : "the live version"
        } for every agent on their next pull.`}
        confirmLabel="Roll back"
        destructive
        isPending={rollback.isPending}
        onConfirm={() => {
          if (rollbackTarget) rollback.mutate(rollbackTarget.id);
        }}
      />

      <ConfirmDialog
        open={confirmVisibility}
        onOpenChange={setConfirmVisibility}
        title={isPublic ? `Make ${repo} private?` : `Make ${repo} public?`}
        description={
          isPublic
            ? "People and agents outside this organization lose access, including anyone already installing it."
            : "Anyone can read this skill and its files, and it appears in the public registry. Check it holds nothing internal first."
        }
        confirmLabel={isPublic ? "Make private" : "Make public"}
        destructive={!isPublic}
        isPending={changeVisibility.isPending}
        onConfirm={() => changeVisibility.mutate(isPublic ? "private" : "public")}
      />

      <ConfirmDialog
        open={leaveBlocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) leaveBlocker.reset?.();
        }}
        title="Discard unsaved changes?"
        description="Your edits to this skill haven't been saved."
        confirmLabel="Discard and leave"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => leaveBlocker.proceed?.()}
      />
    </div>
  );
}
