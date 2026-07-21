import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { clientFetchBase } from "./client-api-base";
import { clearPersistedQueryCache } from "./query-cache";

export const DEFAULT_SIGN_OUT_REDIRECT = "/login";

export const authClient = createAuthClient({
  baseURL: clientFetchBase(),
  plugins: [magicLinkClient(), passkeyClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signOut, useSession } = authClient;

/**
 * Resolve a post-auth redirect to a SAME-SITE absolute URL.
 *
 * A `?redirect=` param is attacker-controllable, so anything that isn't a plain
 * same-site path — absolute URLs (`https://evil`), protocol-relative (`//evil`),
 * or backslash host-confusion (`/\evil`, `/%5Cevil`) — is dropped to a safe
 * default. Otherwise sign-in could bounce a victim to a credential-harvest page.
 */
function resolveClientRedirect(path: string, fallback = "/dashboard"): string {
  const safePath = isSameSitePath(path) ? path : fallback;
  if (typeof window === "undefined") {
    return safePath;
  }
  return `${window.location.origin}${safePath}`;
}

/** True only for a same-origin absolute path (no scheme, host, or `//` tricks). */
export function isSameSitePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  // Must be rooted, and must not start a scheme-relative or backslash-escaped
  // authority. Reject any control chars that browsers may strip before parsing.
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (/^\/%2[fF]/.test(path) || /^\/%5[cC]/.test(path)) return false;
  return true;
}

/**
 * Better Auth does not redirect after sign-out — callers must navigate explicitly.
 * Always hard-redirect so protected routes and cached session state reset cleanly.
 */
export async function signOutAndRedirect(redirectTo = DEFAULT_SIGN_OUT_REDIRECT) {
  const target = resolveClientRedirect(redirectTo);
  let redirected = false;

  // Drop the persisted query cache so org data never outlives the session.
  clearPersistedQueryCache();

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

export async function signInWithPasskey(callbackURL = "/dashboard") {
  const result = await signIn.passkey({
    fetchOptions: {
      onSuccess: () => {
        window.location.assign(resolveClientRedirect(callbackURL));
      },
    },
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Passkey sign-in failed");
  }
  return result;
}

export async function linkSocialProvider(provider: "github" | "google", callbackURL = "/account") {
  const result = await authClient.linkSocial({
    provider,
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
  if (result.error) {
    throw new Error(result.error.message ?? `Failed to link ${provider}`);
  }
  if (result.data?.url) {
    window.location.assign(result.data.url);
  }
  return result;
}

/** Enterprise OIDC / SSO via Better Auth generic OAuth (`SSO_PROVIDER_ID`, default `sso`). */
export async function signInWithSso(
  callbackURL = "/dashboard",
  providerId = import.meta.env.VITE_SSO_PROVIDER_ID || "sso",
) {
  const base = clientFetchBase();
  const res = await fetch(`${base}/api/auth/sign-in/oauth2`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId,
      callbackURL: `${window.location.origin}${callbackURL}`,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "SSO sign-in is not configured");
  }
  const data = (await res.json()) as { url?: string; redirect?: boolean };
  if (data.url) {
    window.location.assign(data.url);
  }
  return data;
}
