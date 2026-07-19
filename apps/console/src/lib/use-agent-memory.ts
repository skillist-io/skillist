import type { RememberInput } from "@skillist/contracts";
import { api } from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** One durable governance fact the agent carries across conversations. */
export type AgentMemory = {
  id: string;
  orgId: string;
  /** null = org-wide (visible to every member); set = pinned to one user. */
  userId: string | null;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

/** The PII the server stripped before persisting, tallied per pattern. */
export type RedactionMatch = { name: string; count: number };

/**
 * The org's durable agent memory — the facts injected into the system prompt
 * every turn. The list is the caller's visible scope (org-wide rows plus their
 * own user-scoped ones); writes are PII-redacted server-side, so `upsert`
 * returns the redaction tally to surface back to the user.
 *
 * The route wraps its payload as `{ memories }`; `api` doesn't unwrap, so the
 * query maps to the array — matching the `use-agent-chats` pattern.
 */
export function useAgentMemory(orgId: string) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["agent-memory", orgId],
    queryFn: () =>
      api<{ memories: AgentMemory[] }>(`/v1/orgs/${orgId}/agent/memory`).then((r) => r.memories),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent-memory", orgId] });
  }, [queryClient, orgId]);

  const upsert = useMutation({
    mutationFn: (input: RememberInput) =>
      api<{ ok: boolean; redacted: RedactionMatch[] }>(`/v1/orgs/${orgId}/agent/memory`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const forget = useMutation({
    mutationFn: (key: string) =>
      api<{ ok: boolean }>(`/v1/orgs/${orgId}/agent/memory/${encodeURIComponent(key)}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });

  return {
    memories: data ?? [],
    isPending,
    isError,
    refetch,
    upsert,
    forget,
  };
}
