import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  QueryError,
  Skeleton,
} from "@skillist/ui";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { type AgentApproval, useAgentApprovals } from "@/lib/use-agent-approvals";

/** "2h ago" formatter, matching chat-history's — prose-adjacent, no mono. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Turn a tool name like `draft_improvement` into "Draft improvement". */
function humanizeTool(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The human-in-the-loop approval queue for the agent's write actions. The agent
 * stages a gated call (starting with `draft_improvement`) as a pending row; the
 * user approves or denies here, and the action runs (or is refused) the next
 * time the agent reaches for it. Scoped to the caller server-side.
 *
 * Self-contained trigger + dialog; the trigger badges the pending count so a
 * waiting action is visible without opening the panel.
 */
export function ApprovalsPanel({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const { approvals, pendingCount, isPending, isError, refetch, decide } = useAgentApprovals(orgId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative gap-2">
          <ShieldCheck className="size-3.5" aria-hidden />
          Approvals
          {pendingCount > 0 && (
            <Badge variant="destructive" aria-label={`${pendingCount} awaiting approval`}>
              {pendingCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg gap-6">
        <DialogHeader>
          <DialogTitle>Agent approvals</DialogTitle>
          <DialogDescription>
            Write actions the agent staged for your review. Approve to let it proceed; deny to
            refuse.
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
            Nothing awaiting review. When the agent tries a gated action, it'll wait for you here.
          </p>
        ) : (
          <ul className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto">
            {approvals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                onDecide={(status) => decide.mutate({ id: a.id, status })}
                isDeciding={decide.isPending && decide.variables?.id === a.id}
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
  approved: { label: "Approved", variant: "secondary" },
  denied: { label: "Denied", variant: "destructive" },
};

function ApprovalRow({
  approval,
  onDecide,
  isDeciding,
}: {
  approval: AgentApproval;
  onDecide: (status: "approved" | "denied") => void;
  isDeciding: boolean;
}) {
  const badge = STATUS_BADGE[approval.status];
  const isPending = approval.status === "pending";
  // Border keys off the signal accent while waiting; a decided row is quiet.
  return (
    <li
      className={`flex flex-col gap-2.5 border p-3 ${
        isPending ? "border-l-2 border-l-signal border-border" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {humanizeTool(approval.toolName)}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {approval.args && Object.keys(approval.args).length > 0 && (
        <dl className="flex flex-col gap-1 border-y border-border py-2">
          {Object.entries(approval.args).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[auto_1fr] gap-x-3">
              <dt className="font-mono text-[0.625rem] text-muted-foreground uppercase">{k}</dt>
              <dd className="truncate font-mono text-xs text-foreground" title={stringifyArg(v)}>
                {stringifyArg(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {isPending
            ? `Requested ${relativeTime(approval.createdAt)}`
            : approval.decidedAt
              ? `Decided ${relativeTime(approval.decidedAt)}`
              : ""}
        </span>
        {isPending && (
          <div className="flex gap-2">
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
              {isDeciding ? "…" : "Approve"}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Render a single arg value compactly for the summary list. */
function stringifyArg(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
