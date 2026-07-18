import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouteErrorFallback } from "@/components/route-error";
import { ThemeProvider } from "@/components/theme-provider";
import { useSession } from "@/lib/auth-client";
import { buildPersistOptions, createAppQueryClient, ensureCacheOwner } from "@/lib/query-cache";
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
  defaultPreloadStaleTime: 0,
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
