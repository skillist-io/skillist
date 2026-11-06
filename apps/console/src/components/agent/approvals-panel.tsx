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
import { useId, useState } from "react";
import { useActiveOrg } from "@/lib/active-org";
import { relativeTime } from "@/lib/relative-time";
import { type AgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";
import { ApprovalTitle } from "./approval-card";
import {
  canDecideApprovals,
  decisionError,
  describeApproval,
  NEEDS_EDITOR,
  STATUS_LABEL,
} from "./approval-copy";

/**
 * The queue and record of the agent's gated actions. Decisions normally happen on
 * the card in the conversation; this is where anything still waiting can be found,
 * and where what ran or was denied stays on record. Approving here runs the action
 * too, in its own conversation, or a fresh one if that's gone, so the verb means the
 * same thing as on the card. Scoped to the caller server-side.
 *
 * Self-contained trigger + dialog. The count sits on the trigger so a waiting
 * action is visible without opening the panel.
 */
export function ApprovalsPanel({
  orgId,
  compact = false,
  onOpenChat,
  onRun,
}: {
  orgId: string;
  /** Icon and count only, for the drawer's narrow toolbar. */
  compact?: boolean;
  /** Show a conversation. The dialog closes so the chat is what's left on screen. */
  onOpenChat?: (chatId: string) => void;
  /** Run an approved action. The dialog closes so its conversation is what's left. */
  onRun: (approval: Pick<AgentApproval, "id" | "chatId">) => void;
}) {
  const [open, setOpen] = useState(false);
  const { approvals, pendingCount, isPending, isError, refetch, decide } = useAgentApprovals(orgId);

  const run = (approval: AgentApproval) => {
    onRun(approval);
    setOpen(false);
  };

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
            good for one run, within 24 hours. Org owners can read these requests in Governance.
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
                onDecide={(status) =>
                  decide.mutate(
                    { id: a.id, status },
                    {
                      onSuccess: () => {
                        if (status === "approved") run(a);
                      },
                    },
                  )
                }
                onRun={() => run(a)}
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

const STATUS_VARIANT: Record<AgentApproval["status"], "default" | "secondary" | "destructive"> = {
  pending: "default",
  approved: "default",
  executed: "secondary",
  denied: "secondary",
  revoked: "secondary",
  expired: "secondary",
  refused: "destructive",
};

function ApprovalRow({
  approval,
  orgId,
  onDecide,
  onRun,
  isDeciding,
  error,
  onOpenChat,
}: {
  approval: AgentApproval;
  orgId: string;
  onDecide: (status: "approved" | "denied" | "revoked") => void;
  onRun: () => void;
  isDeciding: boolean;
  error: unknown;
  onOpenChat?: (chatId: string) => void;
}) {
  const isPending = approval.status === "pending";
  const canDecide = canDecideApprovals(useActiveOrg().activeOrg?.role);
  const copy = describeApproval(approval.toolName, approval.args);
  const { chatId } = approval;
  const titleId = useId();

  return (
    <li
      className={cn(
        "flex flex-col gap-2 border p-3",
        isPending ? "border-signal" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span id={titleId} className="text-sm font-medium wrap-break-word text-foreground">
          <ApprovalTitle copy={copy} />
        </span>
        <Badge variant={STATUS_VARIANT[approval.status]} className="shrink-0">
          {STATUS_LABEL[approval.status]}
        </Badge>
      </div>
      {(isPending || approval.status === "approved") && (
        <p className="text-sm text-muted-foreground">{copy.effect}</p>
      )}
      {copy.detail && (
        <p
          className={cn(
            "text-sm wrap-break-word whitespace-pre-wrap",
            copy.detailIsData && "font-mono text-xs",
          )}
        >
          {copy.detail}
        </p>
      )}
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
            ? canDecide
              ? `Requested ${relativeTime(approval.createdAt)}`
              : NEEDS_EDITOR
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
          {approval.status === "approved" && canDecide && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => onDecide("revoked")}
              >
                Revoke
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={onRun}
              >
                Run now
              </Button>
            </>
          )}
          {isPending && canDecide && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => onDecide("denied")}
              >
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isDeciding}
                aria-describedby={titleId}
                onClick={() => onDecide("approved")}
              >
                {isDeciding ? "Saving…" : copy.approveLabel}
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
