import { getSharedSession } from "@skillist/ui";
import { isRedirect, redirect } from "@tanstack/react-router";

/**
 * A failed `getSession()` is not the same as "you are signed out", and treating
 * it as one is how a rate-limited or briefly-unreachable API signed people out
 * mid-session. Only an explicit 401/403 means the session was rejected; 429 and
 * 5xx are transient, so they get one retry and then an honest "couldn't reach
 * the sign-in service" instead of a claim about the user's session.
 */
const RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 2;

function isTransient(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

/** Where to return after sign-in — including search, so filters/tabs survive. */
function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unreachable(): never {
  // Still cannot render a protected route, so we redirect — but the message
  // says the service was unreachable rather than telling a user with a
  // perfectly valid session that it could not be verified.
  throw redirect({
    to: "/login",
    search: { redirect: currentPath(), error: "auth_unreachable" },
  });
}

export async function requireAuth() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

    try {
      // Destructured straight off the call on purpose: that is what keeps the
      // discriminated union narrowing intact, so `return session` below stays a
      // concrete type. Hoisting the result into a `GetSessionResult` alias
      // widens it and collapses TanStack's route context to `any` downstream.
      //
      // Shared rather than direct so a burst of hover-preloads and rapid
      // navigations collapses onto one request instead of one per route match.
      const { data: session, error } = await getSharedSession();

      if (!error) {
        if (session?.user) return session;
        // A clean response carrying no user is the one unambiguous signed-out
        // case. No error banner — the user simply needs to sign in.
        throw redirect({ to: "/login", search: { redirect: currentPath() } });
      }

      // The session was explicitly rejected: expired or revoked. "Sign in
      // again" is the correct advice here, and only here.
      if (error.status === 401 || error.status === 403) {
        throw redirect({
          to: "/login",
          search: { redirect: currentPath(), error: "session_unavailable" },
        });
      }

      if (isTransient(error.status) && !isLastAttempt) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      unreachable();
    } catch (err) {
      if (isRedirect(err)) throw err;
      // Network-level failure (offline, DNS, aborted) — never a signed-out signal.
      if (isLastAttempt) unreachable();
      await sleep(RETRY_DELAY_MS);
    }
  }

  unreachable();
}
