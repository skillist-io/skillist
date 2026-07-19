import { api, NativeSelect, type Org, QueryError, Skeleton } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AgentChat } from "@/components/agent/agent-chat";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/agent")({
  beforeLoad: () => requireAuth(),
  component: AgentPage,
});

const STORE_KEY = "skillist:agent:org";

function AgentPage() {
  const {
    data: orgs,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const [orgId, setOrgId] = useState<string | null>(null);

  // Default the target org to the last-used one (if still a member) or the
  // first org. The `["orgs"]` query only returns orgs the user belongs to, so
  // any id it yields is one the API agent gate will accept.
  useEffect(() => {
    if (!orgs?.length) return;
    setOrgId((current) => {
      if (current && orgs.some((o) => o.id === current)) return current;
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORE_KEY) : null;
      if (stored && orgs.some((o) => o.id === stored)) return stored;
      return orgs[0]?.id ?? null;
    });
  }, [orgs]);

  useEffect(() => {
    if (orgId && typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, orgId);
  }, [orgId]);

  // Fill the viewport below the sticky app header; the transcript scrolls
  // internally rather than the page.
  const shell =
    "flex flex-col h-[calc(100svh-3.5rem-2rem)] md:h-[calc(100svh-3.5rem-3rem)] -m-4 md:-m-6";

  if (isError) {
    return (
      <div className={shell}>
        <div className="p-4">
          <QueryError title="Could not load organizations" onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className={shell}>
        <Header>
          <Skeleton className="h-9 w-48" />
        </Header>
        <div className="flex-1" />
      </div>
    );
  }

  if (!orgs.length) {
    return (
      <div className={shell}>
        <Header />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-prose text-center text-sm text-muted-foreground">
            You're not a member of any organization yet. Create one on the{" "}
            <Link to="/dashboard" className="underline underline-offset-2">
              dashboard
            </Link>{" "}
            to talk to its agent.
          </p>
        </div>
      </div>
    );
  }

  const activeOrg = orgs.find((o) => o.id === orgId) ?? orgs[0];
  if (!activeOrg) return null;

  return (
    <div className={shell}>
      <Header>
        <div className="flex items-center gap-2">
          <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
            Org
          </span>
          <NativeSelect
            aria-label="Active organization"
            value={activeOrg.id}
            onChange={(e) => setOrgId(e.target.value)}
            className="h-9 w-auto min-w-40"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </Header>
      {/* Remount on org switch → useAgent/useAgentChat rebuild against the new
          DO instance with no stale-message window. */}
      <AgentChat key={activeOrg.id} orgId={activeOrg.id} orgName={activeOrg.name} />
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Skillist Agent
        </span>
        <span className="text-sm font-medium">Org intelligence</span>
      </div>
      {children}
    </div>
  );
}
