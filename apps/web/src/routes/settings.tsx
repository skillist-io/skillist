import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { oauthRedirectUris } from "@skillist/auth";
import { requireAuth } from "@/lib/require-auth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const redirects = oauthRedirectUris(API_URL);

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuth(),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Passwordless auth, API keys, and org membership
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>GitHub OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://better-auth.com/docs/authentication/github"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Better Auth GitHub guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Create a GitHub OAuth App and set the callback URL to:
          </p>
          <code className="block rounded bg-muted px-2 py-1">
            {redirects.github}
          </code>
          <p className="text-muted-foreground">
            GitHub Apps must grant Email Addresses → Read-only. Include{" "}
            <code>user:email</code> scope (configured server-side).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google OAuth</CardTitle>
          <CardDescription>
            <a
              href="https://better-auth.com/docs/authentication/google"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Better Auth Google guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            In Google Cloud Console → Credentials, add this authorized redirect
            URI:
          </p>
          <code className="block rounded bg-muted px-2 py-1">
            {redirects.google}
          </code>
          <p className="text-muted-foreground">
            Set <code>BETTER_AUTH_URL</code> to your API origin to avoid{" "}
            <code>redirect_uri_mismatch</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent API keys</CardTitle>
          <CardDescription>
            Create scoped keys from your org dashboard for agent clients
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          Use <code>POST /v1/orgs/:orgId/api-keys</code> with scopes:
          skills:read, skills:write, feedback:submit, feedback:approve,
          skills:publish.
        </CardContent>
      </Card>
    </div>
  );
}
