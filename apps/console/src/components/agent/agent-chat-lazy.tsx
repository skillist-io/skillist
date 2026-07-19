import { cn, Skeleton } from "@skillist/ui";
import { lazy, Suspense } from "react";
import type { AgentContext } from "@/lib/agent-context";

/**
 * The agent transcript, split out of the initial bundle.
 *
 * <AgentChat> pulls in the AI SDK, the Agents SDK client, and the markdown
 * renderer — several megabytes of dependency that nothing else in the console
 * needs. Because the drawer is mounted in the app shell, a static import would
 * put all of it on the critical path of *every* page. Loading it on first open
 * keeps it off every route that never asks for it.
 *
 * The fallback deliberately mirrors the real layout — transcript above,
 * composer pinned below — so opening the drawer shows its structure
 * immediately instead of an empty panel that fills in a beat later.
 */
const AgentChat = lazy(() => import("./agent-chat").then((m) => ({ default: m.AgentChat })));

/**
 * Starts fetching the chunk before it is needed — called on hover/focus of the
 * agent trigger, so the module is usually warm by the time the drawer opens.
 * Safe to call repeatedly; the import cache dedupes.
 */
export function prefetchAgentChat() {
  void import("./agent-chat");
}

export function LazyAgentChat(props: {
  orgId: string;
  orgName: string;
  context?: AgentContext;
  compact?: boolean;
}) {
  return (
    <Suspense fallback={<AgentChatSkeleton compact={props.compact} />}>
      <AgentChat {...props} />
    </Suspense>
  );
}

function AgentChatSkeleton({ compact }: { compact?: boolean }) {
  const width = compact ? "max-w-none" : "max-w-3xl";
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy role="status">
      <span className="sr-only">Loading the agent</span>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={cn("mx-auto flex w-full flex-col gap-5 px-4 py-6", width)}>
          <Skeleton className="size-9 rounded-none" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40 rounded-none" />
            <Skeleton className="h-4 w-full max-w-prose rounded-none" />
            <Skeleton className="h-4 w-3/4 max-w-prose rounded-none" />
          </div>
        </div>
      </div>
      <div className="border-t border-border">
        <div className={cn("mx-auto flex w-full items-end gap-2 px-4 py-3", width)}>
          <Skeleton className="h-10 flex-1 rounded-none" />
          <Skeleton className="size-10 rounded-none" />
        </div>
      </div>
    </div>
  );
}
