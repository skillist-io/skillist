import { authClient } from "@skillist/ui";
import { isRedirect, redirect } from "@tanstack/react-router";

export async function requireAuth() {
  try {
    const { data: session, error } = await authClient.getSession();
    if (error) {
      throw redirect({
        to: "/login",
        search: {
          redirect: window.location.pathname,
          error: "session_unavailable",
        },
      });
    }
    if (!session?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: window.location.pathname },
      });
    }
    return session;
  } catch (err) {
    if (isRedirect(err)) throw err;
    throw redirect({
      to: "/login",
      search: {
        redirect: window.location.pathname,
        error: "auth_unreachable",
      },
    });
  }
}
