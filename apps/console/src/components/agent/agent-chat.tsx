import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Button, cn, SkillistMark } from "@skillist/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AgentContext, formatApproval, formatContext } from "@/lib/agent-context";
import { useAgentDraft } from "@/lib/use-agent-draft";
import { AgentMessage } from "./agent-message";
import type { ApprovalHandlers } from "./approval-card";
import { Composer } from "./composer";
import type { ConnState } from "./composer-readout";

const SUGGESTIONS = [
  "What required skills are drifting?",
  "Any recurring failures?",
  "Which evals are stale?",
  "Recommend skills we should require.",
];

/**
 * How long after a turn ends a send is refused. Stop and Send occupy the same spot,
 * so a keypress meant for Stop can arrive just after the turn ends.
 */
const SWAP_GUARD_MS = 400;

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
  focusOnReady = false,
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
  /** Move focus to the composer on mount, for the ⌘K drawer. */
  focusOnReady?: boolean;
  /** Ask the owner to refetch the conversation index (new chat + auto-title). */
  onListRefresh?: () => void;
}) {
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [input, setInput] = useAgentDraft(orgId);
  const [chatState, setChatState] = useState<AgentState>({});
  // Per-user-message variant index; unset means "show the latest".
  const [variantIndex, setVariantIndex] = useState<Record<string, number>>({});
  // Attached by default when we have context, but detachable — a question about
  // something else shouldn't drag the current page along with it.
  const [attachContext, setAttachContext] = useState(true);
  const [regenerateFailed, setRegenerateFailed] = useState(false);
  const [showJump, setShowJump] = useState(false);
  // Enter during a reply: the text waits, and the readout says so.
  const [held, setHeld] = useState(false);
  const settledAt = useRef(0);
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent({
    agent: "skillist-agent",
    // No `host`: the socket stays on this origin, where the Worker forwards
    // /agents/* to the API and the session cookie rides along. CI builds set
    // VITE_API_URL, so deriving the host from it sent the socket to the API
    // domain, which the CSP blocks, and chat never connected.
    name: `${orgId}::${chatId}`,
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
  // Declared ahead of `submit`, which re-pins the view on send.
  const atBottomRef = useRef(true);

  /** A suggestion passes `fromComposer: false`, so one click can't wipe a written draft. */
  const submit = useCallback(
    (text: string, fromComposer = true) => {
      const trimmed = text.trim();
      if (!trimmed || connState !== "connected") return;
      if (isBusy) {
        if (fromComposer) setHeld(true);
        return;
      }
      if (Date.now() - settledAt.current < SWAP_GUARD_MS) return;
      const isFirst = messages.length === 0;
      // The context line goes into the message body rather than a side channel,
      // and the transcript renders it back as a chip — so the agent receives
      // exactly what the sender can see.
      const payload = context && attachContext ? `${formatContext(context)}\n${trimmed}` : trimmed;
      void Promise.resolve(sendMessage({ text: payload })).catch(() => {
        if (fromComposer) setInput(trimmed);
      });
      if (fromComposer) setInput("");
      // Sending is a request to see the answer, wherever the reader had scrolled.
      atBottomRef.current = true;
      // First turn creates the server-side chat row (and, shortly after, its
      // auto-title) — surface it in the index right away.
      if (isFirst) onListRefresh?.();
    },
    [
      attachContext,
      connState,
      context,
      isBusy,
      messages.length,
      sendMessage,
      setInput,
      onListRefresh,
    ],
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
      setRegenerateFailed(false);
      void (agent as unknown as AgentStub)
        .call("regenerateMessage", [userMessageId])
        .catch(() => setRegenerateFailed(true));
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
  // A turn can also stage or run an approval and write memory, so those refresh too.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !isBusy) {
      settledAt.current = Date.now();
      setHeld(false);
      onListRefresh?.();
      void queryClient.invalidateQueries({ queryKey: ["agent-approvals", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["agent-memory", orgId] });
    }
    wasBusy.current = isBusy;
  }, [isBusy, onListRefresh, queryClient, orgId]);
  const lastTitle = useRef<string | null>(null);
  useEffect(() => {
    const title = chatState.title ?? null;
    if (title && title !== lastTitle.current) {
      lastTitle.current = title;
      onListRefresh?.();
    }
  }, [chatState.title, onListRefresh]);

  // Auto-scroll: pin to bottom as messages stream in, and leave the reader alone
  // once they scroll up. No smooth scrolling: each token would start a new
  // animation, and a burst leaves the position behind the pin threshold.
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    setShowJump(!atBottomRef.current);
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);
  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  // Focus doesn't wait for the socket, because the field stays editable throughout.
  // Skipped on touch, where focusing would throw up the keyboard over the transcript.
  useEffect(() => {
    if (focusOnReady && window.matchMedia("(pointer: fine)").matches) {
      composerRef.current?.focus();
    }
  }, [focusOnReady]);

  // Send and Stop swap as a turn starts and ends, and the focused one is removed.
  // If the person was working in the composer, keep them there; if they had moved
  // on to the page, leave them alone.
  const composerRegionRef = useRef<HTMLDivElement>(null);
  const ownsFocus = useRef(false);
  useEffect(() => {
    const track = (e: Event) => {
      ownsFocus.current = Boolean(composerRegionRef.current?.contains(e.target as Node));
    };
    document.addEventListener("focusin", track);
    document.addEventListener("pointerdown", track);
    return () => {
      document.removeEventListener("focusin", track);
      document.removeEventListener("pointerdown", track);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs because the turn changed
  useEffect(() => {
    if (ownsFocus.current) composerRef.current?.focus();
  }, [isBusy]);

  // A growing composer shrinks the transcript from below, hiding the last lines.
  useEffect(() => {
    const region = composerRegionRef.current;
    if (!region) return;
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  // Detaching was a choice about one page, so it shouldn't follow the person around.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs because the page changed
  useEffect(() => {
    setAttachContext(true);
  }, [context?.pathname]);

  const approvals = useMemo<ApprovalHandlers>(
    () => ({
      orgId,
      canRun: canSend,
      onRun: (approvalId) => {
        if (!canSend) return;
        atBottomRef.current = true;
        sendMessage({ text: formatApproval(approvalId) });
      },
    }),
    [orgId, canSend, sendMessage],
  );

  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  const isEmpty = messages.length === 0;
  // An assistant message exists from the first event, before it has anything to
  // show, so "is there a reply" has to mean "is there content".
  const last = messages.at(-1);
  const replyStarted =
    last?.role === "assistant" &&
    (last.parts ?? []).some((p) => p.type !== "step-start" && !("text" in p && !p.text.trim()));
  const showThinking = isBusy && !replyStarted;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {/* aria-busy holds announcements until a turn settles, so a screen reader
            reads the finished reply rather than every streamed token. */}
        <div
          role="log"
          aria-label="Conversation"
          aria-busy={isBusy}
          className={cn(
            "mx-auto flex w-full flex-col gap-6 px-4 py-6",
            compact ? "max-w-none" : "max-w-3xl",
          )}
        >
          {isEmpty ? (
            <EmptyState
              orgName={orgName}
              disabled={!canSend}
              onPick={(text) => submit(text, false)}
            />
          ) : (
            messages.map((m, i) => {
              if (m.role !== "assistant") return <AgentMessage key={m.id} message={m} />;
              const streaming = isBusy && i === messages.length - 1;
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
                  approvals={approvals}
                  streaming={streaming}
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
          {(error || regenerateFailed) && !isBusy && (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
              <p>
                {regenerateFailed
                  ? "The agent couldn't start that reply."
                  : "The agent's reply failed before it finished."}
                {error?.message ? ` ${error.message}` : ""}
              </p>
              {lastUserId && connState === "connected" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegenerate(lastUserId)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <div className="pointer-events-none flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={jumpToLatest}
            className="pointer-events-auto absolute z-10 -translate-y-11 gap-2 bg-background"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            Latest
          </Button>
        </div>
      )}

      <ConnectionBanner state={connState} reason={connError} />

      <div ref={composerRegionRef} className="border-t border-border">
        <Composer
          ref={composerRef}
          orgName={orgName}
          value={input}
          onChange={setInput}
          onSubmit={() => submit(input)}
          onStop={stop}
          connState={connState}
          terminal={connState === "disconnected" && Boolean(connError)}
          busy={isBusy}
          held={held}
          context={context}
          contextAttached={attachContext}
          onToggleContext={() => setAttachContext((v) => !v)}
          className={compact ? "max-w-none" : "max-w-3xl"}
        />
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
      {/* The socket stamp, same treatment as the sidebar rail: ink tile with
          the aperture knocked out. Square context, so the mark — the horizontal
          logo stays wordmark-only. */}
      <div
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center bg-foreground text-background"
      >
        <SkillistMark className="size-9" />
      </div>
      <div className="space-y-1">
        <h2 className="text-title">Skillist Agent</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ask about coverage, recurring failures, stale evals, and what {orgName} should require —
          the agent reads your org's telemetry and can draft improvements.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Try asking</span>
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
      {terminal ? `Disconnected: ${reason}` : "Reconnecting to the agent…"}
      {terminal && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Reload
        </button>
      )}
    </div>
  );
}
