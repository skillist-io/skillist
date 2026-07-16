import { isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export async function requireAuth() {
  try {
    const result = await authClient.getSession();
    if (result.error) {
      throw redirect({
        to: "/login",
        search: {
          redirect: window.location.pathname,
          error: "session_unavailable",
        },
      });
    }
    if (!result.data?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: window.location.pathname },
      });
    }
    return result.data;
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
