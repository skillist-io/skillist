import { NativeSelect, QueryError, Skeleton } from "@skillist/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LazyAgentChat } from "@/components/agent/agent-chat-lazy";
import { useAgentContext } from "@/lib/agent-context";
import { requireAuth } from "@/lib/require-auth";
import { useAgentOrg } from "@/lib/use-agent-org";

export const Route = createFileRoute("/agent")({
  beforeLoad: () => requireAuth(),
  component: AgentPage,
});

/**
 * The agent's full-page surface, for long sessions. The global drawer
 * (<AgentDrawer>, mounted in the app shell) is the ambient one; both key the
 * same Durable Object by org, so they share a single transcript.
 */
function AgentPage() {
  const { orgs, activeOrg, setOrgId, isPending, isError, refetch } = useAgentOrg();
  const context = useAgentContext();

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

  if (!activeOrg) {
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
      <LazyAgentChat
        key={activeOrg.id}
        orgId={activeOrg.id}
        orgName={activeOrg.name}
        context={context}
      />
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
