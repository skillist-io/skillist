import { RouteErrorFallback } from "@skillist/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { PublicLayout } from "@/components/public-layout";

// Marketing site (skillist.io): every route is public and rendered inside the
// PublicLayout. Authenticated surfaces live on the console app
// (console.skillist.io); links there are external.
function RootLayout() {
  return (
    <PublicLayout>
      <Outlet />
    </PublicLayout>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  errorComponent: RouteErrorFallback,
});
