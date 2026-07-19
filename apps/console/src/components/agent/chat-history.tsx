import { Button, cn, Skeleton } from "@skillist/ui";
import { Plus, Trash2 } from "lucide-react";
import type { AgentChat } from "@/lib/use-agent-chats";

/** Compact, dependency-free "2h ago" formatter — prose-adjacent, so no mono. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

/**
 * The conversations list, shared by the /agent page left rail, its mobile
 * popover, and the ⌘K drawer's history popover. Newest-first; the active row
 * carries the signal accent (the one conversation that's "live"). Delete is
 * immediate — a chat is a client-minted id, cheap to recreate.
 */
export function ChatHistoryList({
  chats,
  activeChatId,
  isPending,
  isError = false,
  onSelect,
  onNew,
  onDelete,
  onAfterAction,
  className,
}: {
  chats: AgentChat[];
  activeChatId: string;
  isPending: boolean;
  isError?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void | Promise<void>;
  /** Fired after select/new so a containing popover can close itself. */
  onAfterAction?: () => void;
  className?: string;
}) {
  const handleSelect = (id: string) => {
    onSelect(id);
    onAfterAction?.();
  };
  const handleNew = () => {
    onNew();
    onAfterAction?.();
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 p-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleNew}
          className="w-full justify-start gap-2"
        >
          <Plus className="size-3.5" aria-hidden />
          New chat
        </Button>
      </div>

      <div className="px-3 pb-1">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Conversations
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isError ? (
          <p className="px-1 py-2 text-xs text-destructive">Couldn't load conversations.</p>
        ) : isPending ? (
          <div className="flex flex-col gap-1.5 px-1 py-1" aria-busy role="status">
            <span className="sr-only">Loading conversations</span>
            {[70, 52, 60].map((w) => (
              <Skeleton key={w} className="h-8" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No conversations yet. Ask something to start one.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {chats.map((chat) => {
              const isActive = chat.id === activeChatId;
              const title = chat.title?.trim() || "New chat";
              return (
                <li key={chat.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => handleSelect(chat.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-l-2 py-1.5 pr-8 pl-2.5 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      isActive ? "border-l-signal bg-muted" : "border-l-transparent hover:bg-muted",
                    )}
                  >
                    <span className="w-full truncate text-sm text-foreground">{title}</span>
                    <span className="font-mono text-[0.625rem] text-muted-foreground">
                      {relativeTime(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(chat.id)}
                    aria-label={`Delete conversation: ${title}`}
                    className={cn(
                      "absolute top-1.5 right-1 flex size-6 items-center justify-center text-muted-foreground transition-colors",
                      "hover:text-destructive focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:opacity-100",
                    )}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
