import { redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export async function requireAuth() {
  const { data: session } = await authClient.getSession();
  if (!session?.user) {
    throw redirect({
      to: "/login",
      search: { redirect: window.location.pathname },
    });
  }
  return session;
}
