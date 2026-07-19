import type { AgentApprovalStatus } from "@skillist/contracts";
import { api } from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** A write action the agent staged and is waiting on a human to allow. */
export type AgentApproval = {
  id: string;
  orgId: string;
  userId: string;
  toolName: string;
  callSignature: string;
  args: Record<string, unknown> | null;
  status: AgentApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
};

/**
 * The caller's platform-agent approval queue — the write actions (starting with
 * `draft_improvement`) the agent gated behind a human decision. Scoped to the
 * caller server-side, so one user never sees another's requests. `decide`
 * approves or denies a pending row; on next invocation the agent runs (approved)
 * or refuses (denied).
 *
 * The route wraps its payload as `{ approvals }`; `api` doesn't unwrap, so the
 * query maps to the array.
 */
export function useAgentApprovals(orgId: string) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["agent-approvals", orgId],
    queryFn: () =>
      api<{ approvals: AgentApproval[] }>(`/v1/orgs/${orgId}/agent/approvals`).then(
        (r) => r.approvals,
      ),
    // The agent stages approvals mid-conversation; poll so a freshly gated
    // action shows up without the user reopening the panel.
    refetchInterval: 20_000,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent-approvals", orgId] });
  }, [queryClient, orgId]);

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "denied" }) =>
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
