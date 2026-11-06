import {
  ApiError,
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
import { useEffect, useId, useRef } from "react";
import { useActiveOrg } from "@/lib/active-org";
import { useAgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";
import { useAgentMemory } from "@/lib/use-agent-memory";
import {
  type ApprovalCopy,
  canDecideApprovals,
  currentOrgFact,
  decisionError,
  describeApproval,
  NEEDS_EDITOR,
  outcomeLine,
} from "./approval-copy";

export type ApprovalHandlers = {
  orgId: string;
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
 * The decision goes through the REST route rather than the chat socket: that route
 * enforces the editor role, and approving there is what runs the action.
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
  const { orgId } = handlers;
  const { approvals, isPending, isError, refetch, decide } = useAgentApprovals(orgId);
  const { memories } = useAgentMemory(orgId);
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
  const status = row?.status;
  const name = row?.toolName ?? toolName;
  const copy = describeApproval(
    name,
    args,
    status === "pending" ? currentOrgFact(memories, args) : undefined,
  );
  const deciding = decide.isPending;
  const approving = deciding && decide.variables?.status === "approved";
  const titleId = useId();

  // The pressed button goes away with the decision. Without this, focus drops to the
  // page and a keyboard or screen-reader user has to find their place again.
  const statusRef = useRef<HTMLSpanElement>(null);
  const decidedHere = useRef(false);
  useEffect(() => {
    if (!decidedHere.current || !status || status === "pending") return;
    decidedHere.current = false;
    statusRef.current?.focus();
  }, [status]);

  const act = (next: "approved" | "denied" | "revoked") => {
    decidedHere.current = true;
    decide.mutate({ id: approvalId, status: next });
  };

  // Not knowing is different from being told it's gone.
  const missing = single.error instanceof ApiError && single.error.status === 404;
  const unknown = !status && !isPending && !single.isPending && (isError || !missing);

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
        <ItemTitle id={titleId} className="wrap-anywhere">
          <ApprovalTitle copy={copy} />
        </ItemTitle>
        {/* The effect is a promise, so it only shows while it can still come true. */}
        {(status === "pending" || status === "approved") && (
          <ItemDescription>{copy.effect}</ItemDescription>
        )}
        {copy.detail && (
          <p
            className={cn(
              "mt-1 text-sm wrap-anywhere whitespace-pre-wrap",
              copy.detailIsData && "font-mono text-xs",
            )}
          >
            {copy.detail}
          </p>
        )}
        {copy.replaces && (
          <p className="mt-1 text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
            Replaces: {copy.replaces}
          </p>
        )}
        {copy.skillRepo && (
          <Link
            to="/orgs/$orgId/skills/$repo"
            params={{ orgId, repo: copy.skillRepo }}
            className="mt-1 w-fit py-1 text-xs underline underline-offset-4"
          >
            Open {copy.skillRepo}
          </Link>
        )}
      </ItemContent>
      <ItemFooter>
        <span
          ref={statusRef}
          tabIndex={-1}
          role="status"
          className="text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {status === "pending" &&
            (canDecide ? "Nothing has run. Waiting for your decision." : NEEDS_EDITOR)}
          {status === "approved" && "Approved, but it hasn't run."}
          {status && status !== "pending" && status !== "approved"
            ? outcomeLine(status, row?.outcomeReason)
            : null}
          {!status &&
            (isPending || single.isPending
              ? "Checking this request…"
              : unknown
                ? "Couldn't check this request."
                : "This request is no longer open.")}
        </span>
        {status === "pending" && canDecide && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-coarse:h-11"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => act("denied")}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              className="pointer-coarse:h-11"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => act("approved")}
            >
              {approving ? "Running…" : copy.approveLabel}
            </Button>
          </div>
        )}
        {/* Only reachable if the run threw: approving normally runs it in one step. */}
        {status === "approved" && canDecide && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="pointer-coarse:h-11"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => act("revoked")}
            >
              Revoke
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="pointer-coarse:h-11"
              disabled={deciding}
              aria-describedby={titleId}
              onClick={() => act("approved")}
            >
              {approving ? "Running…" : "Run again"}
            </Button>
          </div>
        )}
        {unknown && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="pointer-coarse:h-11"
            onClick={() => {
              void refetch();
              void single.refetch();
            }}
          >
            Retry
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
