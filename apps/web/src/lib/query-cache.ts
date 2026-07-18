import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

const CACHE_KEY = "skillist.query-cache.v1";
const OWNER_KEY = "skillist.query-cache.owner";
/** Bump to invalidate every persisted cache after a breaking response-shape change. */
const CACHE_BUSTER = "v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Never persisted: credential/session material stays in-memory only.
const SENSITIVE_KEY_PREFIXES = ["auth-accounts", "auth-sessions", "auth-passkeys", "api-keys"];

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
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

export function clearPersistedQueryCache(): void {
  const store = storage();
  store?.removeItem(CACHE_KEY);
  store?.removeItem(OWNER_KEY);
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
  }
  store.setItem(OWNER_KEY, userId);
}
