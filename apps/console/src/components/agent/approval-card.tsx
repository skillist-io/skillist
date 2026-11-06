import {
  Button,
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@skillist/ui";
import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useAgentApprovals } from "@/lib/use-agent-approvals";
import { decisionError, describeApproval } from "./approval-copy";

export type ApprovalHandlers = {
  orgId: string;
  /** False while a reply is streaming or the socket is down. */
  canRun: boolean;
  /** Ask the agent to run an approved action. */
  onRun: (approvalId: string) => void;
};

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
  const row = approvals.find((a) => a.id === approvalId);

  // The row was staged moments ago, so the 20s poll usually hasn't seen it.
  useEffect(() => {
    if (!isPending && !row) void refetch();
  }, [isPending, row, refetch]);

  const args = row?.args ?? (input as Record<string, unknown> | null);
  const copy = describeApproval(row?.toolName ?? toolName, args);
  const status = row?.status;
  const deciding = decide.isPending;

  return (
    <Item className={status === "pending" ? "border-signal" : undefined}>
      <ItemMedia className={status === "pending" ? "text-signal" : "text-muted-foreground"}>
        <ShieldCheck aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{copy.title}</ItemTitle>
        {/* The effect is a promise, so it only shows while it can still come true. */}
        {(status === "pending" || status === "approved") && (
          <ItemDescription>{copy.effect}</ItemDescription>
        )}
        {copy.detail && (
          <p className="mt-1 text-sm wrap-break-word whitespace-pre-wrap">{copy.detail}</p>
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
          {status === "pending" && "Nothing has run. Waiting for your decision."}
          {status === "approved" && "Approved. It hasn't run yet."}
          {status === "executed" && "Approved and run."}
          {status === "denied" && "Denied. Nothing ran."}
          {!status && (isPending ? "Checking this request…" : "This request is no longer open.")}
        </span>
        {status === "pending" && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deciding}
              onClick={() => decide.mutate({ id: approvalId, status: "denied" })}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deciding}
              onClick={() =>
                decide.mutate(
                  { id: approvalId, status: "approved" },
                  { onSuccess: () => onRun(approvalId) },
                )
              }
            >
              {deciding ? "Saving…" : "Approve"}
            </Button>
          </div>
        )}
        {/* Covers the run being lost: the socket dropped, or a reply was mid-stream. */}
        {status === "approved" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canRun}
            onClick={() => onRun(approvalId)}
          >
            Run now
          </Button>
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
