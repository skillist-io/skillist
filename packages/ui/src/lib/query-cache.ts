import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { notify } from "./status";

/**
 * Per-mutation wording for the shared status region. Declared here so every
 * `useMutation({ meta })` in the workspace is type-checked against it.
 */
export type MutationStatusMeta = {
  /** Shown when the mutation succeeds. Omit when the page already shows the result. */
  success?: string;
  /** Leads the server's reason on failure, e.g. "Could not publish". */
  failure?: string;
};

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: MutationStatusMeta;
  }
}

const CACHE_KEY = "skillist.query-cache.v1";
const OWNER_KEY = "skillist.query-cache.owner";
/** Bump to invalidate every persisted cache after a breaking response-shape change. */
const CACHE_BUSTER = "v2";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Unsent agent drafts, in sessionStorage. They can hold pasted secrets, so they go when the user does. */
export const AGENT_DRAFT_PREFIX = "skillist:agent:draft:";

// Never persisted: credential/session material stays in-memory only.
const SENSITIVE_KEY_PREFIXES = ["auth-accounts", "auth-sessions", "auth-passkeys", "api-keys"];

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    // One place every mutation passes through, so a failure can't vanish just
    // because a screen forgot to render it. A mutation with its own onError is
    // showing the failure inline, and reporting it here too would say it twice.
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.onError) return;
        const reason = error instanceof Error ? error.message : "Something went wrong";
        const failure = mutation.meta?.failure;
        notify("error", failure ? `${failure}: ${reason}` : reason);
      },
      onSuccess: (_data, _variables, _context, mutation) => {
        const success = mutation.meta?.success;
        if (success) notify("success", success);
      },
    }),
    defaultOptions: {
      queries: {
        // Skill data only changes on save/publish, and the realtime hub
        // invalidates on publish events — long staleTime is safe here.
        staleTime: 5 * 60_000,
        // Must outlive the persister's maxAge or hydrated entries are dropped.
        gcTime: MAX_AGE_MS,
        retry: 1,
      },
    },
  });
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function buildPersistOptions(): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister: createSyncStoragePersister({
      storage: storage() ?? null,
      key: CACHE_KEY,
      throttleTime: 1000,
    }),
    maxAge: MAX_AGE_MS,
    buster: CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        if (query.state.status !== "success") return false;
        const head = query.queryKey[0];
        return typeof head !== "string" || !SENSITIVE_KEY_PREFIXES.includes(head);
      },
    },
  };
}

function purgeAgentDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    const store = window.sessionStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    for (const key of keys) {
      if (key?.startsWith(AGENT_DRAFT_PREFIX)) store.removeItem(key);
    }
  } catch {
    /* sessionStorage may be unavailable, in which case nothing was stored */
  }
}

export function clearPersistedQueryCache(): void {
  const store = storage();
  store?.removeItem(CACHE_KEY);
  store?.removeItem(OWNER_KEY);
  purgeAgentDrafts();
}

/**
 * Scopes the persisted cache to one user. If a different user signs in on the
 * same browser profile, the previous user's cached org data is purged instead
 * of being served to them.
 */
export function ensureCacheOwner(userId: string, queryClient: QueryClient): void {
  const store = storage();
  if (!store) return;
  const previous = store.getItem(OWNER_KEY);
  if (previous !== null && previous !== userId) {
    store.removeItem(CACHE_KEY);
    queryClient.clear();
    purgeAgentDrafts();
  }
  store.setItem(OWNER_KEY, userId);
}
