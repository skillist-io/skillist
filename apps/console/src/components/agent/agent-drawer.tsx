import type { Org } from "@skillist/ui";
import {
  Button,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  QueryError,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
} from "@skillist/ui";
import { Link } from "@tanstack/react-router";
import { MessagesSquare, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { LazyAgentChat, prefetchAgentChat } from "@/components/agent/agent-chat-lazy";
import { ApprovalsPanel } from "@/components/agent/approvals-panel";
import { ChatHistoryList } from "@/components/agent/chat-history";
import { MemoryPanel } from "@/components/agent/memory-panel";
import { useAgentContext } from "@/lib/agent-context";
import { useAgentChats } from "@/lib/use-agent-chats";
import { useAgentOrg } from "@/lib/use-agent-org";

/**
 * The platform agent, reachable from every authenticated route.
 *
 * It is a side drawer rather than a modal so the page stays readable while you
 * ask about it — the whole point of the context attachment is that you are
 * looking at the thing you are asking about.
 *
 * Conversations live in the agent's Durable Object, keyed by `${orgId}::${chatId}`
 * and indexed per user; this drawer and the full /agent page read the same
 * index, so a chat started on one is reachable from the other.
 */
export function AgentDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { orgs, activeOrg, setOrgId, isPending, isError, refetch } = useAgentOrg();
  const context = useAgentContext();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md lg:max-w-lg"
        aria-describedby={undefined}
      >
        {/* pr-14 clears SheetContent's absolutely-positioned close button, which
            sits at top-4 right-4 and would otherwise land on the org select. */}
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-border py-3 pr-14 pl-4">
          <SheetTitle className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
            Skillist Agent
          </SheetTitle>
          <div className="flex items-center justify-between gap-3">
            <SheetDescription className="text-sm font-medium text-foreground">
              Org intelligence
            </SheetDescription>
            {orgs.length > 1 && activeOrg && (
              <NativeSelect
                aria-label="Active organization"
                value={activeOrg.id}
                onChange={(e) => setOrgId(e.target.value)}
                className="h-8 w-auto min-w-28"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        </div>

        {isError ? (
          <div className="p-4">
            <QueryError title="Could not load organizations" onRetry={() => void refetch()} />
          </div>
        ) : isPending ? (
          <div className="p-4">
            <Skeleton className="h-9 w-48" />
          </div>
        ) : !activeOrg ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="max-w-prose text-center text-sm text-muted-foreground">
              You're not a member of any organization yet. Create one on the{" "}
              <Link to="/dashboard" className="underline underline-offset-2">
                dashboard
              </Link>{" "}
              to talk to its agent.
            </p>
          </div>
        ) : (
          // Remount on org switch → the conversation index + active chat reset
          // to the new org.
          <DrawerBody key={activeOrg.id} activeOrg={activeOrg} context={context} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  activeOrg,
  context,
}: {
  activeOrg: Org;
  context: ReturnType<typeof useAgentContext>;
}) {
  const { chatId, chats, isPending, isError, selectChat, newChat, deleteChat, invalidate } =
    useAgentChats(activeOrg.id);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-2 py-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => newChat()}>
            <Plus className="size-3.5" aria-hidden />
            New chat
          </Button>
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <MessagesSquare className="size-3.5" aria-hidden />
                History
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <div className="max-h-[60svh] min-h-0">
                <ChatHistoryList
                  chats={chats}
                  activeChatId={chatId}
                  isPending={isPending}
                  isError={isError}
                  onSelect={selectChat}
                  onNew={newChat}
                  onDelete={deleteChat}
                  onAfterAction={() => setHistoryOpen(false)}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {/* Same agent-governance controls as the full page, kept reachable from
            the ambient drawer. */}
        <div className="flex items-center gap-1">
          <MemoryPanel orgId={activeOrg.id} />
          <ApprovalsPanel orgId={activeOrg.id} />
        </div>
      </div>

      {/* Remount on chat switch → useAgent/useAgentChat rebuild against the new
          DO instance with no stale-message window. */}
      <LazyAgentChat
        key={chatId}
        orgId={activeOrg.id}
        orgName={activeOrg.name}
        chatId={chatId}
        context={context}
        compact
        onListRefresh={invalidate}
      />
    </>
  );
}

/**
 * Open state plus the ⌘K / Ctrl-K accelerator.
 *
 * The shortcut is ignored while the user is typing somewhere else, so it cannot
 * swallow a keystroke meant for a field or the bundle editor.
 */
export function useAgentDrawer() {
  const [open, setOpen] = useState(false);

  // Warm the agent chunk once the shell is idle. It is off the critical path
  // either way; fetching it during a quiet moment means the first ⌘K is
  // instant instead of paying for several megabytes of SDK on open.
  useEffect(() => {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(() => prefetchAgentChat(), { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(prefetchAgentChat, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT");
      // Still allow closing from inside the drawer's own composer.
      if (typing && !open) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return { open, setOpen };
}
