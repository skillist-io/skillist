import { api, type Org } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// The one source of truth for "which org am I acting as" across the whole
// console. Persisted so a reload lands on the same org.
const STORE_KEY = "skillist:active-org";
// The agent surfaces used to own org selection under this key. Read it as a
// fallback so an in-flight user who had a chosen agent org keeps it after the
// consolidation, then everything writes the new key going forward.
const LEGACY_STORE_KEY = "skillist:agent:org";
// Long enough to read while the page settles, short enough not to linger.
const SWITCH_NOTICE_MS = 6000;

type ActiveOrgValue = {
  orgs: Org[];
  activeOrg: Org | null;
  activeOrgId: string | null;
  setActiveOrgId: (id: string) => void;
  /** Follow a link into an org, telling the reader if that changed their scope. */
  followOrgFromUrl: (id: string) => void;
  /** Name of the org a link just moved the reader to. Clears itself. */
  switchNotice: string | null;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

const ActiveOrgContext = createContext<ActiveOrgValue | null>(null);

/**
 * Global active-org state. Fetches the member-org list ONCE (via the shared
 * `["orgs"]` query key, so React Query dedupes with the sidebar and any other
 * reader) and resolves a single active org for every consumer.
 *
 * Consumers read through `useActiveOrg()` — there is no other org-selection
 * `useState` anywhere in the console; the top-bar <OrgSwitcher> is the only
 * control that changes it.
 */
export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const {
    data: orgs,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

  // Resolve the active org once the list arrives (or changes): keep the current
  // choice if it's still a member, else the stored key (new key first, then the
  // legacy agent key for continuity), else the first org. The `["orgs"]` query
  // only returns orgs the user belongs to, so any id it yields is valid.
  useEffect(() => {
    if (!orgs?.length) return;
    setActiveOrgIdState((current) => {
      if (current && orgs.some((o) => o.id === current)) return current;
      if (typeof window !== "undefined") {
        const stored =
          window.localStorage.getItem(STORE_KEY) ?? window.localStorage.getItem(LEGACY_STORE_KEY);
        if (stored && orgs.some((o) => o.id === stored)) return stored;
      }
      return orgs[0]?.id ?? null;
    });
  }, [orgs]);

  const setActiveOrgId = useCallback((id: string) => {
    setActiveOrgIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, id);
  }, []);

  const activeOrg = useMemo(
    () => orgs?.find((o) => o.id === activeOrgId) ?? orgs?.[0] ?? null,
    [orgs, activeOrgId],
  );

  // Rail pages act on this org, so a link that moves it changes what the next
  // click does. On a governance tool that can't happen silently. A ref, because
  // the hook below must stay keyed on the URL alone (see its comment).
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const activeRef = useRef(activeOrg);
  activeRef.current = activeOrg;
  const followOrgFromUrl = useCallback(
    (id: string) => {
      const previous = activeRef.current;
      if (previous && previous.id !== id) {
        setSwitchNotice(orgs?.find((o) => o.id === id)?.name ?? null);
      }
      setActiveOrgId(id);
    },
    [orgs, setActiveOrgId],
  );

  useEffect(() => {
    if (!switchNotice) return;
    const timer = setTimeout(() => setSwitchNotice(null), SWITCH_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [switchNotice]);

  const value = useMemo<ActiveOrgValue>(
    () => ({
      orgs: orgs ?? [],
      activeOrg,
      // Report the resolved org's id (not the raw state, which is null until the
      // first resolve) so consumers key their fetches off a stable value.
      activeOrgId: activeOrg?.id ?? null,
      setActiveOrgId,
      followOrgFromUrl,
      switchNotice,
      isPending,
      isError,
      refetch: () => void refetch(),
    }),
    [orgs, activeOrg, setActiveOrgId, followOrgFromUrl, switchNotice, isPending, isError, refetch],
  );

  return <ActiveOrgContext.Provider value={value}>{children}</ActiveOrgContext.Provider>;
}

export function useActiveOrg(): ActiveOrgValue {
  const ctx = useContext(ActiveOrgContext);
  if (!ctx) throw new Error("useActiveOrg must be used within <ActiveOrgProvider>");
  return ctx;
}

/**
 * Point the global active org at the org in the URL, for `/orgs/$orgId/*` routes
 * (projects, skill editor). Landing on a deep link then reflects that org in the
 * top-bar switcher and every other surface.
 *
 * Keyed on the param (and org list) only — NOT on `activeOrgId` — so a later
 * manual switch via the top-bar switcher (which changes `activeOrgId`, not the
 * URL) isn't immediately reverted here; the switcher handles that case by
 * navigating. A param that isn't one of the caller's orgs is ignored (the route
 * itself gates access).
 */
export function useSyncActiveOrgFromParam(orgId: string | undefined): void {
  const { orgs, followOrgFromUrl } = useActiveOrg();
  useEffect(() => {
    if (!orgId || !orgs.some((o) => o.id === orgId)) return;
    followOrgFromUrl(orgId);
  }, [orgId, orgs, followOrgFromUrl]);
}
