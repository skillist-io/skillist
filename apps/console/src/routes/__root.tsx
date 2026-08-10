import { ConsentBanner, RouteErrorFallback } from "@skillist/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthShell } from "@/components/auth-shell";

// Console (console.skillist.io): /login and /invite get the auth shell,
// everything else is an authenticated surface in the app shell. There is no
// public marketing layout here — that lives on the web app (skillist.io).
//
// /invite is here because an invitee arrives from an email while signed out.
// The app shell mounts ActiveOrgProvider and the org switcher, which would
// fetch orgs they have no session for — 401s behind navigation chrome that
// means nothing until they have actually joined something.
const UNAUTHENTICATED_ROUTES = new Set(["/login", "/invite"]);

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (UNAUTHENTICATED_ROUTES.has(pathname)) {
    return (
      <AuthShell>
        <Outlet />
        <ConsentBanner />
      </AuthShell>
    );
  }

  return (
    <AppShell>
      <Outlet />
      <ConsentBanner />
    </AppShell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  errorComponent: RouteErrorFallback,
});
