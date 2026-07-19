import { api } from "@skillist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

/** One row in the caller's conversation index for an org agent. */
export type AgentChat = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

const storeKey = (orgId: string) => `skillist:agent:chat:${orgId}`;

function readStored(orgId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storeKey(orgId));
  } catch {
    return null;
  }
}

function writeStored(orgId: string, chatId: string) {
  try {
    window.localStorage.setItem(storeKey(orgId), chatId);
  } catch {
    /* localStorage may be unavailable — ignore */
  }
}

function freshId(): string {
  return crypto.randomUUID();
}

/**
 * The caller's named conversations with an org's agent, plus which one is
 * active.
 *
 * The chat id is a client-minted uuid that keys the per-user/per-chat Durable
 * Object (`${orgId}::${chatId}`); the Worker injects the user id from the
 * session, so the client never supplies it. The active id is persisted per org
 * in localStorage, so returning to the agent reopens the last conversation.
 * `newChat` mints a fresh uuid — the transcript component is keyed on it
 * upstream, so a new id is a clean rebuild with no stale-message window.
 *
 * The index itself lives server-side; both agent surfaces (the /agent page and
 * the ⌘K drawer) read the same `["agent-chats", orgId]` query, so a chat
 * created on one shows up on the other.
 */
export function useAgentChats(orgId: string) {
  const queryClient = useQueryClient();

  const {
    data: chats,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["agent-chats", orgId],
    // The route wraps the list as `{ chats }`; `api` doesn't unwrap, so map to
    // the array here — the rest of the hook (and the sidebar) works on `chats`.
    queryFn: () =>
      api<{ chats: AgentChat[] }>(`/v1/orgs/${orgId}/agent/chats`).then((r) => r.chats),
  });

  const [chatId, setChatId] = useState<string>(() => readStored(orgId) ?? freshId());

  // Reset to the org's last-used (or a fresh) conversation when the org
  // switches underneath us — the useState initializer only runs once.
  const orgRef = useRef(orgId);
  useEffect(() => {
    if (orgRef.current === orgId) return;
    orgRef.current = orgId;
    setChatId(readStored(orgId) ?? freshId());
  }, [orgId]);

  // Persist the active id per org.
  useEffect(() => {
    writeStored(orgId, chatId);
  }, [orgId, chatId]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent-chats", orgId] });
  }, [queryClient, orgId]);

  const selectChat = useCallback((id: string) => setChatId(id), []);

  const newChat = useCallback(() => {
    const fresh = freshId();
    setChatId(fresh);
    return fresh;
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      // Optimistic removal so the row disappears immediately.
      queryClient.setQueryData<AgentChat[]>(["agent-chats", orgId], (prev) =>
        prev ? prev.filter((c) => c.id !== id) : prev,
      );
      // Deleting the open conversation drops us into a fresh one.
      setChatId((current) => (current === id ? freshId() : current));
      try {
        await api<{ ok: true }>(`/v1/orgs/${orgId}/agent/chats/${id}`, { method: "DELETE" });
      } catch {
        // Swallow — the reconcile below re-syncs from the server, so a row
        // that survived the delete reappears rather than silently vanishing.
      } finally {
        invalidate();
      }
    },
    [orgId, queryClient, invalidate],
  );

  return {
    chatId,
    chats: chats ?? [],
    isPending,
    isError,
    refetch,
    invalidate,
    selectChat,
    newChat,
    deleteChat,
  };
}
