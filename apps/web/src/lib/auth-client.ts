import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { clientFetchBase } from "./client-api-base";

export const DEFAULT_SIGN_OUT_REDIRECT = "/login";

export const authClient = createAuthClient({
  baseURL: clientFetchBase(),
  plugins: [magicLinkClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signOut, useSession } = authClient;

function resolveClientRedirect(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    return normalized;
  }
  return `${window.location.origin}${normalized}`;
}

/**
 * Better Auth does not redirect after sign-out — callers must navigate explicitly.
 * Always hard-redirect so protected routes and cached session state reset cleanly.
 */
export async function signOutAndRedirect(redirectTo = DEFAULT_SIGN_OUT_REDIRECT) {
  const target = resolveClientRedirect(redirectTo);
  let redirected = false;

  const redirect = () => {
    if (redirected || typeof window === "undefined") return;
    redirected = true;
    window.location.assign(target);
  };

  try {
    const { error } = await signOut({
      fetchOptions: {
        onSuccess: redirect,
        onError: redirect,
      },
    });
    if (error) {
      console.error("Sign out failed:", error.message);
    }
  } catch (err) {
    console.error("Sign out error:", err);
  } finally {
    redirect();
  }
}

export async function signInWithGitHub(callbackURL = "/dashboard") {
  const result = await signIn.social({
    provider: "github",
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
  if (result.error) {
    throw new Error(result.error.message ?? "GitHub sign-in failed");
  }
  if (result.data?.url) {
    window.location.assign(result.data.url);
  }
  return result;
}

export async function signInWithGoogle(callbackURL = "/dashboard") {
  const result = await signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Google sign-in failed");
  }
  if (result.data?.url) {
    window.location.assign(result.data.url);
  }
  return result;
}

export async function sendMagicLink(email: string, callbackURL = "/dashboard") {
  return signIn.magicLink({
    email,
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
}
