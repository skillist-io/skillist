import type { Org } from "@skillist/ui";
import {
  Button,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  QueryError,
  Skeleton,
} from "@skillist/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { LazyAgentChat } from "@/components/agent/agent-chat-lazy";
import { ApprovalsPanel } from "@/components/agent/approvals-panel";
import { ChatHistoryList } from "@/components/agent/chat-history";
import { MemoryPanel } from "@/components/agent/memory-panel";
import { useAgentContext } from "@/lib/agent-context";
import { requireAuth } from "@/lib/require-auth";
import { useAgentChats } from "@/lib/use-agent-chats";
import { useAgentOrg } from "@/lib/use-agent-org";

export const Route = createFileRoute("/agent")({
  beforeLoad: () => requireAuth(),
  component: AgentPage,
});

/**
 * The agent's full-page surface, for long sessions. The global drawer
 * (<AgentDrawer>, mounted in the app shell) is the ambient one; both key the
 * agent's Durable Object by `${orgId}::${chatId}` and read the same conversation
 * index, so a chat started on one appears on the other.
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
      {/* Remount the whole workspace (history + chat) on org switch so the
          conversation index and active chat reset cleanly to the new org. */}
      <AgentWorkspace
        key={activeOrg.id}
        activeOrg={activeOrg}
        orgs={orgs}
        setOrgId={setOrgId}
        context={context}
      />
    </div>
  );
}

function AgentWorkspace({
  activeOrg,
  orgs,
  setOrgId,
  context,
}: {
  activeOrg: Org;
  orgs: Org[];
  setOrgId: (id: string) => void;
  context: ReturnType<typeof useAgentContext>;
}) {
  const { chatId, chats, isPending, isError, selectChat, newChat, deleteChat, invalidate } =
    useAgentChats(activeOrg.id);
  const [historyOpen, setHistoryOpen] = useState(false);

  const list = (onAfterAction?: () => void) => (
    <ChatHistoryList
      chats={chats}
      activeChatId={chatId}
      isPending={isPending}
      isError={isError}
      onSelect={selectChat}
      onNew={newChat}
      onDelete={deleteChat}
      onAfterAction={onAfterAction}
    />
  );

  return (
    <>
      <Header>
        <div className="flex items-center gap-2">
          {/* Below md the rail is hidden — reach history through a popover. */}
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 md:hidden">
                <MessagesSquare className="size-3.5" aria-hidden />
                Chats
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <div className="max-h-[60svh] min-h-0">{list(() => setHistoryOpen(false))}</div>
            </PopoverContent>
          </Popover>
          {/* Memory + approvals govern the agent itself, so they live beside
              the org selector on the shared header rather than in the chat. */}
          <MemoryPanel orgId={activeOrg.id} />
          <ApprovalsPanel orgId={activeOrg.id} />
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

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
          {list()}
        </aside>
        {/* Remount on chat switch → useAgent/useAgentChat rebuild against the
            new DO instance with no stale-message window. */}
        <LazyAgentChat
          key={chatId}
          orgId={activeOrg.id}
          orgName={activeOrg.name}
          chatId={chatId}
          context={context}
          onListRefresh={invalidate}
        />
      </div>
    </>
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
