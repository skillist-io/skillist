import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthShell } from "@/components/auth-shell";
import { PublicLayout } from "@/components/public-layout";
import { RouteErrorFallback } from "@/components/route-error";

function isAppRoute(pathname: string) {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/governance") ||
    pathname.startsWith("/inventory") ||
    pathname.startsWith("/observability") ||
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

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RouteErrorFallback,
});
