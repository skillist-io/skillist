import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

const baseURL = import.meta.env.VITE_API_URL ?? "";

export const authClient = createAuthClient({
  baseURL,
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;

export async function signInWithGitHub(callbackURL = "/dashboard") {
  return signIn.social({
    provider: "github",
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
}

export async function signInWithGoogle(callbackURL = "/dashboard") {
  return signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
}

export async function sendMagicLink(email: string, callbackURL = "/dashboard") {
  return signIn.magicLink({
    email,
    callbackURL: `${window.location.origin}${callbackURL}`,
  });
}
