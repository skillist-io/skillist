import {
  Button,
  cn,
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@skillist/ui";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useId } from "react";
import { useActiveOrg } from "@/lib/active-org";
import { useAgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";
import {
  type ApprovalCopy,
  canDecideApprovals,
  decisionError,
  describeApproval,
  NEEDS_EDITOR,
  OUTCOME,
} from "./approval-copy";

export type ApprovalHandlers = {
  orgId: string;
  /** False while a reply is streaming or the socket is down. */
  canRun: boolean;
  /** Ask the agent to run an approved action. */
  onRun: (approvalId: string) => void;
};

/** The action in words, with the fact key or skill repo set as the data it is. */
export function ApprovalTitle({ copy }: { copy: ApprovalCopy }) {
  return (
    <>
      {copy.action}
      {copy.subject && <span className="font-mono"> {copy.subject}</span>}
    </>
  );
}

/**
 * The AI Elements Confirmation pattern, at the point in the conversation where
 * the agent asked. As upstream notes, a pending approval is a prompt rather than
 * activity, so it sits outside the Trace.
 *
 * The decision still goes through the REST route rather than the chat socket:
 * that route is what enforces the editor role.
 */
export function ApprovalCard({
  approvalId,
  toolName,
  input,
  handlers,
}: {
  approvalId: string;
  toolName: string;
  input: unknown;
  handlers: ApprovalHandlers;
}) {
  const { orgId, canRun, onRun } = handlers;
  const { approvals, isPending, refetch, decide } = useAgentApprovals(orgId);
  const listed = approvals.find((a) => a.id === approvalId);
  // The list stops at 100, so an older card looks itself up rather than giving up.
  const single = useAgentApproval(orgId, approvalId, !isPending && !listed);
  const row = listed ?? single.data;
  const canDecide = canDecideApprovals(useActiveOrg().activeOrg?.role);

  // The row was staged moments ago, so the 20s poll usually hasn't seen it.
  useEffect(() => {
    if (!isPending && !row) void refetch();
  }, [isPending, row, refetch]);

  const args = row?.args ?? (input as Record<string, unknown> | null);
  const copy = describeApproval(row?.toolName ?? toolName, args);
  const status = row?.status;
  const deciding = decide.isPending;
  const titleId = useId();

  return (
    <Item
      className={status === "pending" ? "border-signal" : undefined}
      // The transcript watches for this, to keep a waiting decision reachable.
      data-approval-pending={status === "pending" ? approvalId : undefined}
    >
      <ItemMedia className={status === "pending" ? "text-signal" : "text-muted-foreground"}>
        <ShieldCheck aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle id={titleId}>
          <ApprovalTitle copy={copy} />
        </ItemTitle>
        {/* The effect is a promise, so it only shows while it can still come true. */}
        {(status === "pending" || status === "approved") && (
          <ItemDescription>{copy.effect}</ItemDescription>
        )}
        {copy.detail && (
          <p
            className={cn(
              "mt-1 text-sm wrap-break-word whitespace-pre-wrap",
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
            className="mt-1 w-fit text-xs underline underline-offset-4"
          >
            Open {copy.skillRepo}
          </Link>
        )}
      </ItemContent>
      <ItemFooter>
        <span role="status" className="text-xs text-muted-foreground">
          {status === "pending" &&
            (canDecide ? "Nothing has run. Waiting for your decision." : NEEDS_EDITOR)}
          {status === "approved" && "Approved. It hasn't run yet."}
          {status && OUTCOME[status]}
          {!status &&
            (isPending || single.isPending
              ? "Checking this request…"
              : "This request is no longer open.")}
        </span>
        {status === "pending" && canDecide && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => decide.mutate({ id: approvalId, status: "denied" })}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() =>
                decide.mutate(
                  { id: approvalId, status: "approved" },
                  { onSuccess: () => onRun(approvalId) },
                )
              }
            >
              {deciding ? "Saving…" : copy.approveLabel}
            </Button>
          </div>
        )}
        {/* Covers the run being lost: the socket dropped, or a reply was mid-stream. */}
        {status === "approved" && canDecide && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => decide.mutate({ id: approvalId, status: "revoked" })}
            >
              Revoke
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canRun}
              aria-describedby={titleId}
              onClick={() => onRun(approvalId)}
            >
              Run now
            </Button>
          </div>
        )}
        {decide.isError && (
          <p role="alert" className="basis-full text-xs text-destructive">
            {decisionError(decide.error)}
          </p>
        )}
      </ItemFooter>
    </Item>
  );
}
