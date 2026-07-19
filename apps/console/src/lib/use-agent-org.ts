import { api, type Org } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const STORE_KEY = "skillist:agent:org";

/**
 * Which org the agent is talking to, shared by the /agent page and the global
 * drawer. Both key the same Durable Object instance by org id, so the transcript
 * is one conversation regardless of which surface it was typed into — switching
 * between them must not switch orgs underneath the user.
 */
export function useAgentOrg() {
  const {
    data: orgs,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const [orgId, setOrgId] = useState<string | null>(null);

  // Default to the last-used org (if still a member) or the first. The
  // `["orgs"]` query only returns orgs the user belongs to, so any id it yields
  // is one the API agent gate will accept.
  useEffect(() => {
    if (!orgs?.length) return;
    setOrgId((current) => {
      if (current && orgs.some((o) => o.id === current)) return current;
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORE_KEY) : null;
      if (stored && orgs.some((o) => o.id === stored)) return stored;
      return orgs[0]?.id ?? null;
    });
  }, [orgs]);

  useEffect(() => {
    if (orgId && typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, orgId);
  }, [orgId]);

  const activeOrg = orgs?.find((o) => o.id === orgId) ?? orgs?.[0] ?? null;

  return { orgs: orgs ?? [], activeOrg, setOrgId, isPending, isError, refetch };
}
