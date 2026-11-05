import {
  type AuditEvent,
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
  type Skill,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

/** The API's maximum page, which is what the export covers. */
const AUDIT_LIMIT = 100;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Neutralize spreadsheet formulas. Resource names and metadata can hold user
 * text, and a cell starting with one of these runs when the CSV is opened.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function metadataSummary(event: AuditEvent): string | null {
  const { from, to } = event.metadata ?? {};
  return typeof from === "string" && typeof to === "string" ? `${from} → ${to}` : null;
}

export function AuditLog({ org }: { org: Pick<Org, "id" | "slug"> }) {
  const [action, setAction] = useState("all");

  const { data: audit } = useQuery({
    queryKey: ["audit", org.id, AUDIT_LIMIT],
    queryFn: () => api<{ items: AuditEvent[] }>(`/v1/orgs/${org.id}/audit?limit=${AUDIT_LIMIT}`),
  });
  // Both are already cached by the sidebar and members card in most sessions.
  const { data: members } = useQuery({
    queryKey: ["members", org.id],
    queryFn: () => api<OrgMember[]>(`/v1/orgs/${org.id}/members`),
  });
  const { data: skills } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
  });

  const memberById = useMemo(() => new Map(members?.map((m) => [m.userId, m])), [members]);
  const skillById = useMemo(() => new Map(skills?.map((s) => [s.id, s])), [skills]);

  const actorName = (event: AuditEvent) => {
    if (event.actorId) {
      const member = memberById.get(event.actorId);
      if (member) return member.name || member.email;
    }
    if (event.actorType !== "user") return event.actorType;
    // Audit rows outlive the account they reference.
    return event.actorId ? `former member ${shortId(event.actorId)}` : "unknown";
  };

  const resourceName = (event: AuditEvent) => {
    const skill = event.resourceId ? skillById.get(event.resourceId) : undefined;
    if (skill) return skill.repo;
    const repo = event.metadata?.repo;
    if (typeof repo === "string") return repo;
    return event.resourceId
      ? `${event.resourceType} ${shortId(event.resourceId)}`
      : event.resourceType;
  };

  const items = audit?.items ?? [];
  const actions = useMemo(() => [...new Set(audit?.items.map((e) => e.action))].sort(), [audit]);
  const visible = action === "all" ? items : items.filter((e) => e.action === action);

  const exportCsv = () => {
    const rows = visible.map((e) =>
      [
        e.createdAt,
        actorName(e),
        e.action,
        resourceName(e),
        e.resourceId ?? "",
        metadataSummary(e) ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = ["time,actor,action,resource,resource_id,change", ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${org.slug}-audit-log.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card size="sm" id="audit-log" className="scroll-mt-28">
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>The latest {AUDIT_LIMIT} governance and publish events</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {items.length === 0 ? (
          <p className="text-muted-foreground">No audit events yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label htmlFor="audit-action">Action</Label>
                <NativeSelect
                  id="audit-action"
                  className="mt-1"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="all">All actions</option>
                  {actions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Time
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Actor
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Action
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Resource
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((event) => {
                    const skill = event.resourceId ? skillById.get(event.resourceId) : undefined;
                    const change = metadataSummary(event);
                    return (
                      <tr key={event.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap text-muted-foreground">
                          {timeFormat.format(new Date(event.createdAt))}
                        </td>
                        <td className="py-2 pr-4">{actorName(event)}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{event.action}</td>
                        <td className="py-2">
                          {skill ? (
                            <Link
                              to="/orgs/$orgId/skills/$repo"
                              params={{ orgId: org.id, repo: skill.repo }}
                              className="hover:underline"
                            >
                              {skill.repo}
                            </Link>
                          ) : (
                            resourceName(event)
                          )}
                          {change && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {change}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
