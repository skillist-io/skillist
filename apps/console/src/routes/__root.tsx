import { RouteErrorFallback } from "@skillist/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthShell } from "@/components/auth-shell";

// Console (console.skillist.io): /login gets the auth shell, everything else is
// an authenticated surface in the app shell. There is no public marketing
// layout here — that lives on the web app (skillist.io).
function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname === "/login") {
    return (
      <AuthShell>
        <Outlet />
      </AuthShell>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  errorComponent: RouteErrorFallback,
});
