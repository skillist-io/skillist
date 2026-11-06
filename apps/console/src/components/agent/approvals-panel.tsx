import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  QueryError,
  Skeleton,
} from "@skillist/ui";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useActiveOrg } from "@/lib/active-org";
import { relativeTime } from "@/lib/relative-time";
import { type AgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";
import { type AgentMemory, useAgentMemory } from "@/lib/use-agent-memory";
import { ApprovalTitle } from "./approval-card";
import {
  canDecideApprovals,
  currentOrgFact,
  decisionError,
  describeApproval,
  NEEDS_EDITOR,
  outcomeLine,
  STATUS_LABEL,
} from "./approval-copy";

/**
 * The queue and record of the agent's gated actions. Decisions normally happen on
 * the card in the conversation; this is where anything still waiting can be found,
 * and where what ran or was denied stays on record. Approving runs the action, here
 * as on the card. Scoped to the caller server-side.
 *
 * Self-contained trigger + dialog. The count sits on the trigger so a waiting
 * action is visible without opening the panel.
 */
export function ApprovalsPanel({
  orgId,
  compact = false,
  onOpenChat,
  chatIds,
}: {
  orgId: string;
  /** Icon and count only, for the drawer's narrow toolbar. */
  compact?: boolean;
  /** Show a conversation. The dialog closes so the chat is what's left on screen. */
  onOpenChat?: (chatId: string) => void;
  /** Conversations that still exist. A request can outlive the chat that asked. */
  chatIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const { approvals, pendingCount, isPending, isError, refetch, decide } = useAgentApprovals(orgId);
  const { memories } = useAgentMemory(orgId);
  // Held here, not in the row: a decided row moves to History, which remounts it.
  const focusAfterDecision = useRef<string | null>(null);

  // Decisions first. Finished rows are history, and shouldn't sit between someone and
  // the thing that's waiting on them.
  const waiting = approvals.filter((a) => a.status === "pending" || a.status === "approved");
  const history = approvals.filter((a) => a.status !== "pending" && a.status !== "approved");

  const row = (a: AgentApproval) => (
    <ApprovalRow
      key={a.id}
      approval={a}
      orgId={orgId}
      memories={memories}
      focusAfterDecision={focusAfterDecision}
      onDecide={(status) => decide.mutate({ id: a.id, status })}
      isDeciding={decide.isPending && decide.variables?.id === a.id}
      deciding={decide.variables?.id === a.id ? decide.variables.status : undefined}
      error={decide.variables?.id === a.id ? decide.error : null}
      onOpenChat={
        onOpenChat && a.chatId && chatIds.has(a.chatId)
          ? (chatId) => {
              onOpenChat(chatId);
              setOpen(false);
            }
          : undefined
      }
    />
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative gap-2"
          title={compact ? "Approvals" : undefined}
        >
          <ShieldCheck className="size-3.5" aria-hidden />
          <span className={compact ? "sr-only" : undefined}>Approvals</span>
          {pendingCount > 0 && (
            <>
              <span aria-hidden className="font-mono text-xs text-signal tabular-nums">
                {pendingCount}
              </span>
              <span className="sr-only">, {pendingCount} awaiting approval</span>
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg gap-6">
        <DialogHeader>
          <DialogTitle>Agent approvals</DialogTitle>
          <DialogDescription>
            Actions the agent asked to take. Nothing runs until you approve it, and approving runs
            it once. Org owners can read these requests in Governance.
          </DialogDescription>
        </DialogHeader>

        {isError ? (
          <QueryError title="Couldn't load approvals" onRetry={() => void refetch()} />
        ) : isPending ? (
          <div className="flex flex-col gap-2" aria-busy role="status">
            <span className="sr-only">Loading approvals</span>
            {[90, 90].map((w) => (
              <Skeleton key={w} className="h-20" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : approvals.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing to review. When the agent asks to take a gated action, it waits for you in the
            conversation and here.
          </p>
        ) : (
          <div className="flex max-h-[min(60svh,34rem)] flex-col gap-4 overflow-y-auto">
            {waiting.length > 0 && <ul className="flex flex-col gap-3">{waiting.map(row)}</ul>}
            {history.length > 0 && (
              <div className="flex flex-col gap-2">
                {waiting.length > 0 && (
                  <h3 className="text-xs font-medium text-muted-foreground">History</h3>
                )}
                <ul className="flex flex-col gap-3">{history.map(row)}</ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATUS_VARIANT: Record<AgentApproval["status"], "default" | "secondary" | "destructive"> = {
  pending: "default",
  approved: "default",
  executed: "secondary",
  denied: "secondary",
  revoked: "secondary",
  expired: "secondary",
  refused: "destructive",
};

/** When the last thing happened, named, because "Decided" hid what was decided. */
function lastEvent(a: AgentApproval): string {
  if (a.status === "revoked" && a.revokedAt) return `Revoked ${relativeTime(a.revokedAt)}`;
  if (a.status === "executed" && a.executedAt) return `Ran ${relativeTime(a.executedAt)}`;
  if (!a.decidedAt) return "";
  const verb = a.status === "denied" ? "Denied" : "Approved";
  return `${verb} ${relativeTime(a.decidedAt)}`;
}

function ApprovalRow({
  approval,
  orgId,
  memories,
  focusAfterDecision,
  onDecide,
  isDeciding,
  deciding,
  error,
  onOpenChat,
}: {
  approval: AgentApproval;
  orgId: string;
  memories: AgentMemory[];
  focusAfterDecision: { current: string | null };
  onDecide: (status: "approved" | "denied" | "revoked") => void;
  isDeciding: boolean;
  deciding?: "approved" | "denied" | "revoked";
  error: unknown;
  onOpenChat?: (chatId: string) => void;
}) {
  const { status } = approval;
  const isPending = status === "pending";
  const canDecide = canDecideApprovals(useActiveOrg().activeOrg?.role);
  const copy = describeApproval(
    approval.toolName,
    approval.args,
    isPending ? currentOrgFact(memories, approval.args) : undefined,
  );
  const { chatId } = approval;
  const titleId = useId();
  const approving = isDeciding && deciding === "approved";

  // The pressed button goes away with the decision, so hand focus to what replaced it.
  const eventRef = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs because the status changed
  useEffect(() => {
    if (focusAfterDecision.current !== approval.id || status === "pending") return;
    focusAfterDecision.current = null;
    eventRef.current?.focus();
  }, [status]);
  const act = (next: "approved" | "denied" | "revoked") => {
    focusAfterDecision.current = approval.id;
    onDecide(next);
  };

  const button = "pointer-coarse:h-11";

  return (
    <li
      className={cn(
        "flex flex-col gap-2 border p-3",
        isPending ? "border-signal" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* min-w-0 first: a flex child won't shrink below its longest word without it,
            and a long key pushed the status clean out of the row. */}
        <span id={titleId} className="min-w-0 text-sm font-medium wrap-anywhere text-foreground">
          <ApprovalTitle copy={copy} />
        </span>
        <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      {(isPending || status === "approved") && (
        <p className="text-sm text-muted-foreground">{copy.effect}</p>
      )}
      {copy.detail && (
        <p
          className={cn(
            "text-sm wrap-anywhere whitespace-pre-wrap",
            copy.detailIsData && "font-mono text-xs",
          )}
        >
          {copy.detail}
        </p>
      )}
      {copy.replaces && (
        <p className="text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
          Replaces: {copy.replaces}
        </p>
      )}
      {status === "refused" && (
        <p className="text-xs text-muted-foreground">
          {outcomeLine(status, approval.outcomeReason)}
        </p>
      )}
      {copy.skillRepo && (
        <Link
          to="/orgs/$orgId/skills/$repo"
          params={{ orgId, repo: copy.skillRepo }}
          className="w-fit py-1 text-xs underline underline-offset-4"
        >
          Open {copy.skillRepo}
        </Link>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          ref={eventRef}
          tabIndex={-1}
          className="text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isPending
            ? canDecide
              ? `Requested ${relativeTime(approval.createdAt)}`
              : NEEDS_EDITOR
            : lastEvent(approval)}
        </span>
        <div className="flex items-center gap-2">
          {chatId && onOpenChat && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={button}
              onClick={() => onOpenChat(chatId)}
            >
              Open chat
            </Button>
          )}
          {/* Only reachable if the run threw: approving normally runs it in one step. */}
          {status === "approved" && canDecide && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={button}
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => act("revoked")}
              >
                Revoke
              </Button>
              <Button
                type="button"
                size="sm"
                className={button}
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => act("approved")}
              >
                {approving ? "Running…" : "Run again"}
              </Button>
            </>
          )}
          {isPending && canDecide && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={button}
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => act("denied")}
              >
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                className={button}
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => act("approved")}
              >
                {approving ? "Running…" : copy.approveLabel}
              </Button>
            </>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {decisionError(error)}
        </p>
      ) : null}
    </li>
  );
}
