import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  getOAuthClientInfo,
  submitOAuthConsent,
  useSession,
} from "@skillist/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

/**
 * MCP authorization consent.
 *
 * Anyone can register an MCP client with any name and logo, so this page is the
 * only thing between a lookalike client and a user's token. The name is labelled
 * as self-reported, the redirect host is shown beside it, and the icon is
 * deliberately not rendered.
 *
 * Better Auth verifies the signed query string, so `oauthProviderClient` has to
 * see it unchanged: don't navigate or rewrite search params on this route.
 */
export const Route = createFileRoute("/oauth/consent")({
  validateSearch: z.object({
    client_id: z.string().optional(),
    redirect_uri: z.string().optional(),
    scope: z.string().optional(),
  }),
  component: ConsentPage,
});

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name and profile picture",
  email: "See your email address",
  offline_access: "Stay connected after you close this page",
};

function redirectHost(redirectUri: string | undefined) {
  if (!redirectUri) return null;
  try {
    return new URL(redirectUri).host;
  } catch {
    return null;
  }
}

function ConsentPage() {
  const { client_id: clientId, redirect_uri: redirectUri, scope } = Route.useSearch();
  const { data: session, isPending: sessionPending } = useSession();

  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () => getOAuthClientInfo(clientId as string),
    enabled: Boolean(clientId && session?.user),
    retry: false,
  });

  const decision = useMutation({ mutationFn: submitOAuthConsent });

  const scopes = scope?.split(" ").filter(Boolean) ?? [];
  const host = redirectHost(redirectUri);
  const name = client.data?.client_name ?? "This application";

  if (sessionPending) return null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-12">
      <Card className="w-full">
        {!session?.user ? (
          <CardHeader>
            <CardTitle>Your session has ended</CardTitle>
            <CardDescription>
              Go back to the application and connect again. <Link to="/login">Sign in</Link>
            </CardDescription>
          </CardHeader>
        ) : !clientId || client.isError ? (
          <CardHeader>
            <CardTitle>This request can't be completed</CardTitle>
            <CardDescription>
              We couldn't identify the application asking for access. Go back to it and connect
              again.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Connect {name} to Skillist?</CardTitle>
              <CardDescription>
                The application chose this name itself, and Skillist hasn't verified it. Only
                continue if you started this connection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-1 text-sm">
                <dt className="text-muted-foreground">Signed in as</dt>
                <dd>{session.user.email}</dd>
                {host ? (
                  <>
                    <dt className="pt-2 text-muted-foreground">You'll return to</dt>
                    <dd className="break-all font-mono">{host}</dd>
                  </>
                ) : null}
              </dl>
              {scopes.length > 0 ? (
                <div className="text-sm">
                  <p className="text-muted-foreground">It will be able to:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {scopes.map((item) => (
                      <li key={item}>{SCOPE_LABELS[item] ?? item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {decision.isError ? (
                <p role="alert" className="text-destructive text-sm">
                  {decision.error.message}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={decision.isPending || client.isPending}
                  onClick={() => decision.mutate(true)}
                >
                  Allow access
                </Button>
                <Button
                  variant="outline"
                  disabled={decision.isPending}
                  onClick={() => decision.mutate(false)}
                >
                  Deny
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
