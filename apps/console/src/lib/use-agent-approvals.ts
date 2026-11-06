import type { AgentApprovalStatus } from "@skillist/contracts";
import { api } from "@skillist/ui";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** A write action the agent staged and is waiting on a human to allow. */
export type AgentApproval = {
  id: string;
  orgId: string;
  userId: string;
  toolName: string;
  callSignature: string;
  args: Record<string, unknown> | null;
  /** The conversation that asked; null on rows from before this was recorded. */
  chatId: string | null;
  status: AgentApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Null on rows that ran before this was recorded. */
  executedAt: string | null;
};

/**
 * The caller's platform-agent approval queue — the write actions (starting with
 * `draft_improvement`) the agent gated behind a human decision. Scoped to the
 * caller server-side, so one user never sees another's requests. `decide`
 * approves or denies a pending row, or revokes an approval that hasn't run.
 * Approving doesn't run anything by itself: the agent runs it through
 * `run_approved_action`, and the row becomes `executed`.
 *
 * `orgId` may be null so the app shell can call this before an org is resolved.
 *
 * The route wraps its payload as `{ approvals }`; `api` doesn't unwrap, so the
 * query maps to the array.
 */
export function useAgentApprovals(orgId: string | null) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["agent-approvals", orgId],
    queryFn: () =>
      api<{ approvals: AgentApproval[] }>(`/v1/orgs/${orgId}/agent/approvals`).then(
        (r) => r.approvals,
      ),
    enabled: Boolean(orgId),
    // The agent stages approvals mid-conversation; poll so a freshly gated
    // action shows up without the user reopening the panel.
    refetchInterval: 20_000,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent-approvals", orgId] });
  }, [queryClient, orgId]);

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "denied" | "revoked" }) =>
      api<{ ok: boolean; status: AgentApprovalStatus }>(`/v1/orgs/${orgId}/agent/approvals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
  });

  const approvals = data ?? [];
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return {
    approvals,
    pendingCount,
    isPending,
    isError,
    refetch,
    decide,
  };
}

/**
 * One request by id, for a card older than the list reaches. Without this an old
 * card would claim its request was no longer open, when it's only off the page.
 */
export function useAgentApproval(orgId: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["agent-approvals", orgId, id],
    queryFn: () =>
      api<{ approval: AgentApproval }>(`/v1/orgs/${orgId}/agent/approvals/${id}`).then(
        (r) => r.approval,
      ),
    enabled,
    retry: false,
  });
}

type RecordPage = { approvals: AgentApproval[]; nextBefore: string | null };

/** Every member's requests in an org, for the owner's record in Governance. */
export function useApprovalsRecord(
  orgId: string,
  filters: { status: AgentApprovalStatus | "all"; userId: string | "all" },
) {
  return useInfiniteQuery({
    queryKey: ["agent-approvals-record", orgId, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.userId !== "all") params.set("userId", filters.userId);
      if (pageParam) params.set("before", pageParam);
      return api<RecordPage>(`/v1/orgs/${orgId}/agent/approvals-record?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}
