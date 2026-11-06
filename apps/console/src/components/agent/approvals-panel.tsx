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
import { useState } from "react";
import { relativeTime } from "@/lib/relative-time";
import { type AgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";
import { decisionError, describeApproval } from "./approval-copy";

/**
 * The queue and record of the agent's gated actions. Decisions normally happen on
 * the card in the conversation; this is where anything still waiting can be found,
 * and where what ran or was denied stays on record. Approving here doesn't run the
 * action: that happens from its conversation, so "Open chat" goes there.
 * Scoped to the caller server-side.
 *
 * Self-contained trigger + dialog. The count sits on the trigger so a waiting
 * action is visible without opening the panel.
 */
export function ApprovalsPanel({
  orgId,
  compact = false,
  onOpenChat,
}: {
  orgId: string;
  /** Icon and count only, for the drawer's narrow toolbar. */
  compact?: boolean;
  /** Show a conversation. The dialog closes so the chat is what's left on screen. */
  onOpenChat?: (chatId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { approvals, pendingCount, isPending, isError, refetch, decide } = useAgentApprovals(orgId);

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
            Actions the agent asked to take. Nothing runs without your approval, and an approval is
            good for one run.
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
          <ul className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto">
            {approvals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                orgId={orgId}
                onDecide={(status) => decide.mutate({ id: a.id, status })}
                isDeciding={decide.isPending && decide.variables?.id === a.id}
                error={decide.variables?.id === a.id ? decide.error : null}
                onOpenChat={
                  onOpenChat
                    ? (chatId) => {
                        onOpenChat(chatId);
                        setOpen(false);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATUS_BADGE: Record<
  AgentApproval["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  pending: { label: "Awaiting review", variant: "default" },
  approved: { label: "Approved, not run", variant: "default" },
  executed: { label: "Ran", variant: "secondary" },
  denied: { label: "Denied", variant: "destructive" },
};

function ApprovalRow({
  approval,
  orgId,
  onDecide,
  isDeciding,
  error,
  onOpenChat,
}: {
  approval: AgentApproval;
  orgId: string;
  onDecide: (status: "approved" | "denied") => void;
  isDeciding: boolean;
  error: unknown;
  onOpenChat?: (chatId: string) => void;
}) {
  const badge = STATUS_BADGE[approval.status];
  const isPending = approval.status === "pending";
  const copy = describeApproval(approval.toolName, approval.args);
  const { chatId } = approval;

  return (
    <li
      className={cn(
        "flex flex-col gap-2 border p-3",
        isPending ? "border-signal" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium wrap-break-word text-foreground">{copy.title}</span>
        <Badge variant={badge.variant} className="shrink-0">
          {badge.label}
        </Badge>
      </div>
      {(isPending || approval.status === "approved") && (
        <p className="text-sm text-muted-foreground">{copy.effect}</p>
      )}
      {copy.detail && <p className="text-sm wrap-break-word whitespace-pre-wrap">{copy.detail}</p>}
      {copy.skillRepo && (
        <Link
          to="/orgs/$orgId/skills/$repo"
          params={{ orgId, repo: copy.skillRepo }}
          className="w-fit text-xs underline underline-offset-4"
        >
          Open {copy.skillRepo}
        </Link>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {isPending
            ? `Requested ${relativeTime(approval.createdAt)}`
            : approval.decidedAt
              ? `Decided ${relativeTime(approval.decidedAt)}`
              : ""}
        </span>
        <div className="flex items-center gap-2">
          {chatId && onOpenChat && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChat(chatId)}>
              Open chat
            </Button>
          )}
          {isPending && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecide("denied")}
              >
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecide("approved")}
              >
                {isDeciding ? "Saving…" : "Approve"}
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
