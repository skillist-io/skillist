import {
  api,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type Feedback,
  Label,
  Textarea,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { diffLines, diffStats } from "@/lib/diff";

type FeedbackInboxProps = {
  orgId: string;
  repo: string;
  latestDraftId?: string;
  editorContent: string;
  feedbackBody: string;
  onFeedbackBodyChange: (value: string) => void;
  onSubmit: () => void;
  onApprove: (id: string) => void;
  onApplyDraft: (skillMd: string) => void;
  onPublishDraft: (versionId: string) => void;
  isSubmitting: boolean;
  isApproving: boolean;
  isPublishing: boolean;
};

function jobVariant(status: string) {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

export function FeedbackInbox({
  orgId,
  repo,
  latestDraftId,
  editorContent,
  feedbackBody,
  onFeedbackBodyChange,
  onSubmit,
  onApprove,
  onApplyDraft,
  onPublishDraft,
  isSubmitting,
  isApproving,
  isPublishing,
}: FeedbackInboxProps) {
  const { data: feedbackList } = useQuery({
    queryKey: ["feedback", orgId, repo],
    queryFn: () => api<Feedback[]>(`/v1/orgs/${orgId}/skills/${repo}/feedback`),
    refetchInterval: (query) => {
      const pending = query.state.data?.some(
        (f) => f.aiJob?.status === "queued" || f.aiJob?.status === "running",
      );
      return pending ? 3000 : false;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback inbox</CardTitle>
        <CardDescription>Approve feedback to queue an AI-improved SKILL.md draft</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Submit feedback</Label>
          <Textarea
            value={feedbackBody}
            onChange={(e) => onFeedbackBodyChange(e.target.value)}
            placeholder="Suggest an improvement..."
          />
          <Button
            className="mt-2"
            size="sm"
            onClick={onSubmit}
            disabled={!feedbackBody || !latestDraftId || isSubmitting}
          >
            Submit
          </Button>
        </div>

        {feedbackList?.map((f) => (
          <FeedbackItem
            key={f.id}
            feedback={f}
            orgId={orgId}
            repo={repo}
            editorContent={editorContent}
            onApprove={() => onApprove(f.id)}
            onApplyDraft={onApplyDraft}
            onPublishDraft={onPublishDraft}
            isApproving={isApproving}
            isPublishing={isPublishing}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function FeedbackItem({
  feedback,
  orgId,
  repo,
  editorContent,
  onApprove,
  onApplyDraft,
  onPublishDraft,
  isApproving,
  isPublishing,
}: {
  feedback: Feedback;
  orgId: string;
  repo: string;
  editorContent: string;
  onApprove: () => void;
  onApplyDraft: (skillMd: string) => void;
  onPublishDraft: (versionId: string) => void;
  isApproving: boolean;
  isPublishing: boolean;
}) {
  const draftVersionId = feedback.aiJob?.resultDraftVersionId;

  const { data: draftFiles } = useQuery({
    queryKey: ["files", orgId, repo, draftVersionId],
    queryFn: () =>
      api<{ files: Record<string, string> }>(
        `/v1/orgs/${orgId}/skills/${repo}/versions/${draftVersionId!}/files`,
      ),
    enabled: !!draftVersionId && feedback.aiJob?.status === "completed",
  });

  const draftMd = draftFiles?.files["SKILL.md"];
  const diff = useMemo(() => {
    if (!draftMd) return null;
    return diffLines(editorContent, draftMd);
  }, [draftMd, editorContent]);
  const stats = diff ? diffStats(diff) : null;

  return (
    <div className="border border-border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Badge>{feedback.source}</Badge>
          <Badge>{feedback.status}</Badge>
          {feedback.aiJob && (
            <Badge variant={jobVariant(feedback.aiJob.status)}>
              AI {feedback.aiJob.status}
              {feedback.aiJob.draftSemver ? ` · v${feedback.aiJob.draftSemver}` : ""}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(feedback.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="whitespace-pre-wrap">{feedback.body}</p>

      {feedback.status === "pending" && (
        <Button size="sm" className="mt-2" onClick={onApprove} disabled={isApproving}>
          {isApproving ? "Approving…" : "Approve + AI suggest"}
        </Button>
      )}

      {feedback.aiJob?.status === "failed" && feedback.aiJob.error && (
        <p className="mt-2 text-xs text-destructive">{feedback.aiJob.error}</p>
      )}

      {draftMd && diff && stats && (
        <div className="mt-3 space-y-2 border border-border bg-muted/30 p-2">
          <p className="text-xs font-medium">
            AI draft diff (+{stats.added} / −{stats.removed} lines)
          </p>
          <pre className="max-h-48 overflow-auto border border-border bg-background p-2 font-mono text-xs">
            {diff.slice(0, 80).map((line) => (
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
            {diff.length > 80 && (
              <div className="text-muted-foreground">… {diff.length - 80} more lines</div>
            )}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onApplyDraft(draftMd)}>
              Apply to editor
            </Button>
            {draftVersionId && (
              <Button
                size="sm"
                onClick={() => onPublishDraft(draftVersionId)}
                disabled={isPublishing}
              >
                {isPublishing ? "Publishing…" : "Publish AI draft"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
