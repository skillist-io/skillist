import type { AuthEnv } from "./index";

export const AUTH_CALLBACK_PATHS = {
  github: "/api/auth/callback/github",
  google: "/api/auth/callback/google",
} as const;

export function authCallbackUrl(baseUrl: string, provider: keyof typeof AUTH_CALLBACK_PATHS) {
  return `${baseUrl.replace(/\/$/, "")}${AUTH_CALLBACK_PATHS[provider]}`;
}

export type GitHubProfile = {
  id: number | string;
  login?: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string;
};

export function buildSocialProviders(env: AuthEnv) {
  const providers: Record<string, Record<string, unknown>> = {};

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      // Pin to BETTER_AUTH_URL — the OAuth app registers exactly one callback
      // host, so the request-host-derived default breaks sign-in from skillist.dev.
      redirectURI: authCallbackUrl(env.BETTER_AUTH_URL, "github"),
      scope: ["read:user", "user:email"],
      mapProfileToUser: (profile: GitHubProfile) => {
        const login = profile.login ?? String(profile.id);
        const email = profile.email ?? `${login}@users.noreply.github.com`;
        return {
          id: String(profile.id),
          name: profile.name ?? login,
          email,
          image: profile.avatar_url,
          emailVerified: Boolean(profile.email),
        };
      },
    };
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectURI: authCallbackUrl(env.BETTER_AUTH_URL, "google"),
      // https://better-auth.com/docs/authentication/google
      prompt: "select_account",
    };
  }

  return providers;
}

export function oauthRedirectUris(baseUrl: string) {
  return {
    github: authCallbackUrl(baseUrl, "github"),
    google: authCallbackUrl(baseUrl, "google"),
  };
}
