import { createFileRoute, redirect } from "@tanstack/react-router";

// The console has no landing page — "/" goes straight to the dashboard, which
// its own auth guard bounces to /login when signed out.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
