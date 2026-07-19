import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Button, cn, Textarea } from "@skillist/ui";
import { useAgent } from "agents/react";
import { ArrowUp, Bot, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentHost } from "@/lib/agent-connection";
import { type AgentContext, describeContext, formatContext } from "@/lib/agent-context";
import { AgentMessage } from "./agent-message";

const SUGGESTIONS = [
  "What required skills are drifting?",
  "Any recurring failures?",
  "Which evals are stale?",
  "Recommend skills we should require.",
];

type ConnState = "connecting" | "connected" | "disconnected";

/** One regenerated reply, keyed under the preceding user message id. The parts
 *  shape is owned by the agent runtime; we splice it back onto the live message
 *  (which carries the runtime's own part type) rather than re-typing it here. */
type AssistantVariant = { id?: string; parts?: unknown };
/** The slice of the agent DO's state the transcript reads. */
type AgentState = { title?: string | null; variants?: Record<string, AssistantVariant[]> };
/** Minimal shape of the agent stub's RPC channel — the 2a server exposes
 *  `regenerateMessage(userMessageId)`. If its call form changes when 2a lands,
 *  this is the one line to adjust. */
type AgentStub = { call: <T = unknown>(method: string, args: unknown[]) => Promise<T> };

export function AgentChat({
  orgId,
  orgName,
  chatId,
  context,
  compact = false,
  onListRefresh,
}: {
  orgId: string;
  orgName: string;
  /** Client-minted uuid; keys the per-user/per-chat Durable Object. */
  chatId: string;
  /** Where the user is standing. Attached to the next message when present. */
  context?: AgentContext;
  /** Narrow layout for the drawer — drops the reading-width cap and padding. */
  compact?: boolean;
  /** Ask the owner to refetch the conversation index (new chat + auto-title). */
  onListRefresh?: () => void;
}) {
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<AgentState>({});
  // Per-user-message variant index; unset means "show the latest".
  const [variantIndex, setVariantIndex] = useState<Record<string, number>>({});
  // Attached by default when we have context, but detachable — a question about
  // something else shouldn't drag the current page along with it.
  const [attachContext, setAttachContext] = useState(true);

  const agent = useAgent({
    agent: "skillist-agent",
    name: `${orgId}::${chatId}`,
    host: agentHost(),
    onOpen: () => {
      setConnState("connected");
      setConnError(null);
    },
    onClose: () => setConnState("disconnected"),
    onConnectionError: (err) => {
      // Terminal close (won't reconnect) — e.g. auth/membership rejection.
      setConnState("disconnected");
      setConnError(err.reason?.trim() || err.message || "Connection closed");
    },
    onStateUpdate: (s) => setChatState((s ?? {}) as AgentState),
  });

  const { messages, status, sendMessage, stop, error } = useAgentChat({
    agent,
    credentials: "include",
  });

  const isBusy = status === "submitted" || status === "streaming";
  const canSend = connState === "connected" && !isBusy;

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || connState !== "connected" || isBusy) return;
      const isFirst = messages.length === 0;
      // The context line goes into the message body rather than a side channel,
      // and the transcript renders it back as a chip — so the agent receives
      // exactly what the sender can see.
      const payload = context && attachContext ? `${formatContext(context)}\n${trimmed}` : trimmed;
      sendMessage({ text: payload });
      setInput("");
      // First turn creates the server-side chat row (and, shortly after, its
      // auto-title) — surface it in the index right away.
      if (isFirst) onListRefresh?.();
    },
    [attachContext, connState, context, isBusy, messages.length, sendMessage, onListRefresh],
  );

  // Regenerate the assistant reply to a given user message. Clearing the
  // variant override lets the freshly-produced reply (the latest) show through.
  const handleRegenerate = useCallback(
    (userMessageId: string) => {
      setVariantIndex((prev) => {
        if (!(userMessageId in prev)) return prev;
        const { [userMessageId]: _drop, ...rest } = prev;
        return rest;
      });
      void (agent as unknown as AgentStub).call("regenerateMessage", [userMessageId]).catch(() => {
        /* transient — the connection banner covers a dropped socket */
      });
    },
    [agent],
  );

  const cycleVariant = useCallback(
    (userMessageId: string, direction: "prev" | "next") => {
      const list = chatState.variants?.[userMessageId];
      if (!list || list.length <= 1) return;
      setVariantIndex((prev) => {
        const current = prev[userMessageId] ?? list.length - 1;
        const next =
          direction === "next" ? Math.min(list.length - 1, current + 1) : Math.max(0, current - 1);
        return { ...prev, [userMessageId]: next };
      });
    },
    [chatState.variants],
  );

  // Map each assistant turn to the user message that prompted it, so variant
  // lookups don't re-scan the transcript per row.
  const precedingUserIdByIndex = useMemo(() => {
    const map = new Map<number, string>();
    let lastUserId: string | null = null;
    messages.forEach((m, i) => {
      if (m.role === "user") lastUserId = m.id;
      else if (m.role === "assistant" && lastUserId) map.set(i, lastUserId);
    });
    return map;
  }, [messages]);

  // Refresh the index when a turn settles (picks up the row + auto-title) and
  // whenever the server pushes a new title.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !isBusy) onListRefresh?.();
    wasBusy.current = isBusy;
  }, [isBusy, onListRefresh]);
  const lastTitle = useRef<string | null>(null);
  useEffect(() => {
    const title = chatState.title ?? null;
    if (title && title !== lastTitle.current) {
      lastTitle.current = title;
      onListRefresh?.();
    }
  }, [chatState.title, onListRefresh]);

  // Auto-scroll: pin to bottom as messages stream in. Respects reduced motion
  // via the container's scroll-behavior utility.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const isEmpty = messages.length === 0;
  const showThinking = status === "submitted" && messages.at(-1)?.role !== "assistant";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto"
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-6 px-4 py-6",
            compact ? "max-w-none" : "max-w-3xl",
          )}
        >
          {isEmpty ? (
            <EmptyState orgName={orgName} disabled={!canSend} onPick={submit} />
          ) : (
            messages.map((m, i) => {
              if (m.role !== "assistant") return <AgentMessage key={m.id} message={m} />;
              const userId = precedingUserIdByIndex.get(i);
              const list = userId ? chatState.variants?.[userId] : undefined;
              const total = list?.length ?? 0;
              const selectedIndex = userId
                ? (variantIndex[userId] ?? (total > 0 ? total - 1 : 0))
                : 0;
              // Showing a non-latest variant: swap in its saved snapshot.
              let display = m;
              const v = list && selectedIndex < total ? list[selectedIndex] : undefined;
              if (v) {
                display = {
                  ...m,
                  id: v.id ?? m.id,
                  parts: (v.parts ?? m.parts) as typeof m.parts,
                };
              }
              return (
                <AgentMessage
                  key={m.id}
                  message={display}
                  onRegenerate={userId && !isBusy ? () => handleRegenerate(userId) : undefined}
                  branchIndex={selectedIndex}
                  branchTotal={total}
                  onPrevVariant={userId ? () => cycleVariant(userId, "prev") : undefined}
                  onNextVariant={userId ? () => cycleVariant(userId, "next") : undefined}
                />
              );
            })
          )}
          {showThinking && (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden
                className="size-1.5 animate-pulse bg-signal motion-reduce:animate-none"
              />
              Thinking…
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="border-l-2 border-l-destructive py-1 pl-2.5 text-sm text-destructive"
            >
              The agent hit an error. Try again in a moment.
            </div>
          )}
        </div>
      </div>

      <ConnectionBanner state={connState} reason={connError} />

      <div className="border-t border-border bg-background/80 backdrop-blur">
        {context && (
          <div
            className={cn(
              "mx-auto flex w-full items-center gap-2 px-4 pt-2",
              compact ? "max-w-none" : "max-w-3xl",
            )}
          >
            <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
              Context
            </span>
            {attachContext ? (
              <span className="flex items-center gap-1.5 border border-border px-2 py-0.5 font-mono text-xs text-foreground">
                {describeContext(context)}
                <button
                  type="button"
                  onClick={() => setAttachContext(false)}
                  aria-label="Don't send the current page as context"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAttachContext(true)}
                className="font-mono text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:decoration-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                attach {describeContext(context)}
              </button>
            )}
          </div>
        )}
        <form
          className={cn(
            "mx-auto flex w-full items-end gap-2 px-4 py-3",
            compact ? "max-w-none" : "max-w-3xl",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder={
              connState === "connected" ? `Ask the ${orgName} agent…` : "Connecting to the agent…"
            }
            aria-label="Message the Skillist agent"
            disabled={connState !== "connected"}
            className="max-h-40 min-h-10 flex-1 border border-b-input px-3 py-2"
          />
          {isBusy ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => stop()}
              aria-label="Stop generating"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!canSend || !input.trim()}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  orgName,
  disabled,
  onPick,
}: {
  orgName: string;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-5 py-10">
      <div className="flex size-9 items-center justify-center border border-border">
        <Bot className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-title">Skillist Agent</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ask about coverage, recurring failures, stale evals, and what {orgName} should require —
          the agent reads your org's telemetry and can draft improvements.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Try asking
        </span>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className={cn(
                "border border-border px-3 py-1.5 text-left text-sm transition-colors",
                "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({ state, reason }: { state: ConnState; reason: string | null }) {
  // Suppress the banner on the first-load handshake — the connection always
  // passes through "connecting" for a beat and a banner there would flash.
  const seenConnected = useRef(false);
  useEffect(() => {
    if (state === "connected") seenConnected.current = true;
  }, [state]);

  if (state === "connected") return null;
  if (state === "connecting" && !seenConnected.current) return null;

  const terminal = state === "disconnected" && !!reason;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 border-t px-3 py-1.5 text-xs",
        terminal
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5",
          terminal
            ? "bg-destructive"
            : "animate-pulse bg-muted-foreground motion-reduce:animate-none",
        )}
      />
      {terminal ? `Disconnected — ${reason}` : "Reconnecting to the agent…"}
    </div>
  );
}
