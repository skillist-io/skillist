import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { clientFetchBase } from "./client-api-base";

export const DEFAULT_SIGN_OUT_REDIRECT = "/login";

export const authClient = createAuthClient({
  baseURL: clientFetchBase(),
  plugins: [magicLinkClient(), passkeyClient()],
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

  // Drop the persisted query cache so org data never outlives the session.
  const { clearPersistedQueryCache } = await import("./query-cache");
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
