import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const baseURL = import.meta.env.VITE_API_URL ?? "";

export const authClient = createAuthClient({
  baseURL,
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

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
