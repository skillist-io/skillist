import {
  api,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type InvitationPreview,
  useSession,
} from "@skillist/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Invitation landing page.
 *
 * Deliberately NOT behind `requireAuth()`. The recipient arrives from an email,
 * often signed out and sometimes signed in as the wrong account — bouncing them
 * straight to /login would ask them to authenticate before showing what they
 * are authenticating for, and give them no way to see WHICH address the invite
 * was sent to. So the preview renders publicly (the token is the credential),
 * and sign-in is offered as the next step.
 */
export const Route = createFileRoute("/invite")({
  validateSearch: z.object({
    token: z.string().optional(),
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const { data: session, isPending: sessionPending } = useSession();
  const navigate = useNavigate();

  const {
    data: invitation,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<InvitationPreview>(`/v1/invitations/${encodeURIComponent(token ?? "")}`),
    enabled: Boolean(token),
    // A dead invitation stays dead; re-requesting on every refocus just
    // re-renders the same 404.
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api<{ orgId: string }>(`/v1/invitations/${encodeURIComponent(token ?? "")}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      void navigate({ to: "/dashboard", replace: true });
    },
  });

  if (!token) {
    return <InviteMessage title="Invitation link is incomplete" body="This link has no token." />;
  }

  if (isPending || sessionPending) {
    return <InviteMessage title="Checking invitation…" body="One moment." />;
  }

  if (isError || !invitation) {
    // The API returns one 404 for unknown, revoked, accepted, and expired
    // alike, so the copy cannot claim which of those happened.
    return (
      <InviteMessage
        title="This invitation is no longer valid"
        body="It may have expired, been revoked, or already been accepted. Ask whoever invited you to send a new one."
      />
    );
  }

  const signedInEmail = session?.user?.email;
  const wrongAccount = Boolean(signedInEmail && signedInEmail !== invitation.email);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {invitation.orgName}</CardTitle>
        <CardDescription>
          You've been invited to {invitation.orgName} as <Badge>{invitation.role}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This invitation was sent to <span className="text-foreground">{invitation.email}</span>.
        </p>

        {!signedInEmail && (
          <Button asChild className="w-full">
            {/* Round-trips back here after sign-in, so accepting is one more click. */}
            <Link to="/login" search={{ redirect: `/invite?token=${encodeURIComponent(token)}` }}>
              Sign in to accept
            </Link>
          </Button>
        )}

        {wrongAccount && (
          <p className="text-sm text-destructive">
            You're signed in as {signedInEmail}. Sign in as {invitation.email} to accept this
            invitation.
          </p>
        )}

        {signedInEmail && !wrongAccount && (
          <Button className="w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
            {accept.isPending ? "Joining…" : `Join ${invitation.orgName}`}
          </Button>
        )}

        {accept.isError && (
          <p className="text-sm text-destructive">
            {accept.error instanceof Error
              ? accept.error.message
              : "Could not accept this invitation."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
