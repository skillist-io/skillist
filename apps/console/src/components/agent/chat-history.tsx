import { Button, ConfirmDialog, cn, Input, Skeleton } from "@skillist/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { relativeTime } from "@/lib/relative-time";
import type { AgentChat } from "@/lib/use-agent-chats";

/** Below this the whole list is in view, and a search field is only more chrome. */
const SEARCH_FROM = 6;

/**
 * The conversations list, shared by the /agent page left rail, its mobile
 * popover, and the ⌘K drawer's history popover. Newest-first; the active row
 * carries the signal accent (the one conversation that's "live"). Delete asks
 * first: the transcript is gone for good, and it may be the only record of why
 * something was approved.
 */
export function ChatHistoryList({
  chats,
  activeChatId,
  isPending,
  isError = false,
  deleteFailed = false,
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
  /** The last delete didn't go through, so the row is back. */
  deleteFailed?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void | Promise<void>;
  /** Fired after select/new so a containing popover can close itself. */
  onAfterAction?: () => void;
  className?: string;
}) {
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(needle))
    : chats;

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
        <span className="text-xs text-muted-foreground">Conversations</span>
      </div>

      {chats.length > SEARCH_FROM && (
        <div className="shrink-0 px-2 pb-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            aria-label="Search conversation titles"
          />
        </div>
      )}

      {deleteFailed && (
        <p role="alert" className="px-3 pb-1 text-xs text-destructive">
          Couldn't delete that conversation. Try again.
        </p>
      )}

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
        ) : visible.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">No titles match.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((chat) => {
              const isActive = chat.id === activeChatId;
              const title = chat.title?.trim() || "Untitled chat";
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
                    <span className="font-mono text-xs text-muted-foreground">
                      {relativeTime(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete({ id: chat.id, title })}
                    aria-label={`Delete conversation: ${title}`}
                    className={cn(
                      "absolute top-1.5 right-1 flex size-6 items-center justify-center text-muted-foreground transition-colors",
                      "hover:text-destructive focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:opacity-100 pointer-coarse:opacity-100",
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this conversation?"
        description={`"${pendingDelete?.title ?? ""}" and its full transcript will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) void onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
