import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthShell } from "@/components/auth-shell";
import { PublicLayout } from "@/components/public-layout";
import { RouteErrorFallback } from "@/components/route-error";

function isAppRoute(pathname: string) {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/governance") ||
    pathname.startsWith("/inventory") ||
    pathname.startsWith("/observability") ||
    pathname.startsWith("/admin/mirrors") ||
    pathname.startsWith("/orgs/")
  );
}

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname === "/login") {
    return (
      <AuthShell>
        <Outlet />
      </AuthShell>
    );
  }

  if (isAppRoute(pathname)) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    );
  }

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
