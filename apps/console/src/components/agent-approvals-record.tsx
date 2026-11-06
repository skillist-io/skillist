import type { AgentApprovalStatus } from "@skillist/contracts";
import {
  api,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  type Org,
  type OrgMember,
  QueryError,
  Skeleton,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type AgentApproval, useApprovalsRecord } from "@/lib/use-agent-approvals";
import { ApprovalTitle } from "./agent/approval-card";
import { describeApproval, STATUS_LABEL } from "./agent/approval-copy";
import { reasonWords } from "./agent/tool-outcome";
import { csvCell } from "./audit-log";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

function when(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/**
 * Every member's gated agent actions, for the people accountable for them. It is a
 * record, not a queue: there is nothing to decide here, because an action runs in
 * the conversation of the person who asked, under their identity.
 */
export function AgentApprovalsRecord({ org }: { org: Pick<Org, "id" | "slug"> }) {
  const [status, setStatus] = useState<AgentApprovalStatus | "all">("all");
  const [userId, setUserId] = useState("all");

  const record = useApprovalsRecord(org.id, { status, userId });
  const { data: members } = useQuery({
    queryKey: ["members", org.id],
    queryFn: () => api<OrgMember[]>(`/v1/orgs/${org.id}/members`),
  });

  const memberById = useMemo(() => new Map(members?.map((m) => [m.userId, m])), [members]);
  const nameOf = (id: string) => {
    const member = memberById.get(id);
    return member ? member.name || member.email : `Former member ${id.slice(0, 8)}`;
  };

  /**
   * What happened after the request. Rows from before these were kept say so, because
   * a blank would read as "didn't happen".
   */
  const outcomeLines = (a: AgentApproval): string[] => {
    const lines: string[] = [];
    if (a.decidedAt) {
      const who = a.decidedBy ? nameOf(a.decidedBy) : "decider not recorded";
      const verb = a.status === "denied" ? "Denied" : "Approved";
      lines.push(`${verb} ${when(a.decidedAt)}, ${who}`);
    }
    if (a.status === "revoked" && a.revokedAt) {
      lines.push(`Revoked ${when(a.revokedAt)}, ${a.revokedBy ? nameOf(a.revokedBy) : ""}`);
    }
    if (a.status === "executed") {
      lines.push(a.executedAt ? `Ran ${when(a.executedAt)}` : "Run time not recorded");
    }
    if (a.status === "refused" && a.outcomeReason) {
      lines.push(`Refused: ${reasonWords(a.outcomeReason)}`);
    }
    return lines;
  };

  const rows = record.data?.pages.flatMap((p) => p.approvals) ?? [];
  const filtered = status !== "all" || userId !== "all";

  const exportCsv = () => {
    const lines = rows.map((a) => {
      const copy = describeApproval(a.toolName, a.args);
      return [
        a.createdAt,
        nameOf(a.userId),
        copy.title,
        copy.detail ?? "",
        STATUS_LABEL[a.status],
        a.decidedAt ?? "",
        a.decidedBy ? nameOf(a.decidedBy) : "",
        a.executedAt ?? "",
        a.revokedAt ?? "",
        a.outcomeReason ?? "",
      ]
        .map(csvCell)
        .join(",");
    });
    const csv = [
      "requested,requester,action,text,status,decided,decided_by,ran,revoked,reason",
      ...lines,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${org.slug}-agent-approvals.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card size="sm" id="agent-approvals" className="scroll-mt-28">
      <CardHeader>
        <CardTitle>Agent approvals</CardTitle>
        <CardDescription>
          Every gated action members' agents asked to take, what was decided, and what ran
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <Label htmlFor="approvals-status">Status</Label>
              <NativeSelect
                id="approvals-status"
                className="mt-1"
                value={status}
                onChange={(e) => setStatus(e.target.value as AgentApprovalStatus | "all")}
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="approvals-member">Member</Label>
              <NativeSelect
                id="approvals-member"
                className="mt-1"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="all">All members</option>
                {members?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={exportCsv}>
            Export {rows.length} loaded
          </Button>
        </div>

        {record.isError ? (
          <QueryError title="Couldn't load the record" onRetry={() => void record.refetch()} />
        ) : record.isPending ? (
          <div className="flex flex-col gap-2" aria-busy role="status">
            <span className="sr-only">Loading the record</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">
            {filtered
              ? "No requests match these filters."
              : "No agent actions have needed approval yet."}
          </p>
        ) : (
          <>
            {/* Below md each request stacks, Status first, because a table scrolled sideways
                hid the one column people open this to read. */}
            <div className="md:overflow-x-auto">
              <table className="block w-full md:table md:min-w-[52rem]">
                <thead className="sr-only md:not-sr-only md:table-header-group">
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Requested
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Member
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Action
                    </th>
                    <th scope="col" className="w-64 py-2 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {rows.map((a) => {
                    const copy = describeApproval(a.toolName, a.args);
                    return (
                      <tr
                        key={a.id}
                        className="flex flex-col gap-1 border-b border-border py-2 align-top last:border-0 md:table-row md:py-0"
                      >
                        <td className="font-mono text-xs text-muted-foreground md:py-2 md:pr-4 md:whitespace-nowrap">
                          {when(a.createdAt)}
                        </td>
                        <td className="md:py-2 md:pr-4 md:whitespace-nowrap">{nameOf(a.userId)}</td>
                        <td className="md:py-2 md:pr-4">
                          <span className="wrap-anywhere">
                            <ApprovalTitle copy={copy} />
                          </span>
                          {copy.detail && (
                            <p className="mt-1 text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                              {copy.detail}
                            </p>
                          )}
                        </td>
                        <td className="order-first md:order-none md:py-2">
                          <span
                            className={
                              a.status === "refused"
                                ? "font-medium text-destructive"
                                : "font-medium"
                            }
                          >
                            {STATUS_LABEL[a.status]}
                          </span>
                          {outcomeLines(a).map((line) => (
                            <span key={line} className="block text-xs text-muted-foreground">
                              {line}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {record.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={record.isFetchingNextPage}
                onClick={() => void record.fetchNextPage()}
              >
                {record.isFetchingNextPage ? "Loading…" : "Load older requests"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
