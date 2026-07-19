import {
  buildPersistOptions,
  createAppQueryClient,
  ensureCacheOwner,
  RouteErrorFallback,
  ThemeProvider,
  useSession,
} from "@skillist/ui";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = createAppQueryClient();

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultErrorComponent: RouteErrorFallback,
  // Start route loaders on hover/touch-down so data is already in cache by
  // the time the click lands — combined with route loaders, this is what
  // turns "click, see skeletons" into "click, see content."
  defaultPreload: "intent",
  // Reuse the Query cache's staleness window for preloads so hovering a link
  // whose data is already fresh doesn't fire a redundant refetch. Realtime
  // publish events still invalidate, so this can't serve indefinitely-stale data.
  defaultPreloadStaleTime: 5 * 60_000,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Purges the persisted cache when a different user signs in on this browser. */
function CacheOwnerGuard() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  useEffect(() => {
    if (userId) ensureCacheOwner(userId, queryClient);
  }, [userId]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={buildPersistOptions()}>
        <CacheOwnerGuard />
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
