import { getAuthenticatorName } from "@better-auth/passkey";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  authClient,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  linkSocialProvider,
  PageTitle,
  useSession,
} from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/account")({
  beforeLoad: () => requireAuth(),
  component: AccountPage,
});

type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: Date | string;
};

type AuthSession = {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type PasskeyRow = {
  id: string;
  name?: string | null;
  aaguid?: string | null;
  deviceType?: string | null;
  backedUp: boolean;
  createdAt: Date | string;
};

const LINKABLE_PROVIDERS = [
  { id: "github" as const, label: "GitHub" },
  { id: "google" as const, label: "Google" },
];

function formatWhen(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function providerLabel(providerId: string) {
  if (providerId === "github") return "GitHub";
  if (providerId === "google") return "Google";
  if (providerId === "credential") return "Email";
  return providerId;
}

function AccountPage() {
  const { data: session, refetch: refetchSession } = useSession();
  const user = session?.user;
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name ?? "");
  const [passkeyName, setPasskeyName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  const accountsQuery = useQuery({
    queryKey: ["auth-accounts"],
    queryFn: async () => {
      const { data, error: err } = await authClient.listAccounts();
      if (err) throw new Error(err.message ?? "Failed to load linked accounts");
      return (data ?? []) as LinkedAccount[];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async () => {
      const { data, error: err } = await authClient.listSessions();
      if (err) throw new Error(err.message ?? "Failed to load sessions");
      return (data ?? []) as AuthSession[];
    },
  });

  const passkeysQuery = useQuery({
    queryKey: ["auth-passkeys"],
    queryFn: async () => {
      const { data, error: err } = await authClient.passkey.listUserPasskeys();
      if (err) throw new Error(err.message ?? "Failed to load passkeys");
      return (data ?? []) as PasskeyRow[];
    },
  });

  const updateProfile = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required");
      const { error: err } = await authClient.updateUser({ name: trimmed });
      if (err) throw new Error(err.message ?? "Failed to update profile");
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Profile updated.");
      await refetchSession();
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to update profile");
    },
  });

  const unlink = useMutation({
    mutationFn: async (providerId: string) => {
      const { error: err } = await authClient.unlinkAccount({ providerId });
      if (err) throw new Error(err.message ?? "Failed to unlink account");
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Account unlinked.");
      await queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to unlink account");
    },
  });

  const revokeSession = useMutation({
    mutationFn: async (token: string) => {
      const { error: err } = await authClient.revokeSession({ token });
      if (err) throw new Error(err.message ?? "Failed to revoke session");
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Session revoked.");
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to revoke session");
    },
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error: err } = await authClient.revokeOtherSessions();
      if (err) throw new Error(err.message ?? "Failed to revoke other sessions");
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Other sessions revoked.");
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to revoke other sessions");
    },
  });

  const addPasskey = useMutation({
    mutationFn: async () => {
      const { error: err } = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
      });
      if (err) throw new Error(err.message ?? "Failed to add passkey");
    },
    onSuccess: async () => {
      setPasskeyName("");
      setError(null);
      setMessage("Passkey added.");
      await queryClient.invalidateQueries({ queryKey: ["auth-passkeys"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to add passkey");
    },
  });

  const deletePasskey = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await authClient.passkey.deletePasskey({ id });
      if (err) throw new Error(err.message ?? "Failed to delete passkey");
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Passkey removed.");
      await queryClient.invalidateQueries({ queryKey: ["auth-passkeys"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to delete passkey");
    },
  });

  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const linkedProviderIds = new Set((accountsQuery.data ?? []).map((a) => a.providerId));
  const currentToken = session?.session?.token;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <PageTitle>Account</PageTitle>
        <p className="text-muted-foreground">
          Profile, sign-in methods, passkeys, and active sessions. Org API keys live in{" "}
          <Link to="/settings" className="text-primary underline">
            Settings
          </Link>
          .
        </p>
      </div>

      {message ? (
        <p className="border border-border bg-muted/40 px-3 py-2 text-sm">{message}</p>
      ) : null}
      {error ? (
        <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Display name shown across Skillist. Email is set by your sign-in provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 rounded-none">
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback className="rounded-none">{initials}</AvatarFallback>
            </Avatar>
            <div className="text-sm">
              <p className="font-medium">{user.name}</p>
              <p className="text-muted-foreground">{user.email}</p>
              {user.emailVerified ? (
                <Badge className="mt-1">Email verified</Badge>
              ) : (
                <Badge className="mt-1" variant="outline">
                  Email unverified
                </Badge>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-name">Display name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="sm:max-w-sm"
              />
              <Button
                onClick={() => updateProfile.mutate()}
                disabled={updateProfile.isPending || name.trim() === (user.name ?? "")}
              >
                {updateProfile.isPending ? "Saving…" : "Save name"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            Link GitHub or Google so you can sign in with either method.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(accountsQuery.data ?? []).map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{providerLabel(account.providerId)}</p>
                <p className="text-muted-foreground">Linked {formatWhen(account.createdAt)}</p>
              </div>
              {LINKABLE_PROVIDERS.some((p) => p.id === account.providerId) ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unlink.isPending || (accountsQuery.data?.length ?? 0) <= 1}
                  onClick={() => unlink.mutate(account.providerId)}
                >
                  Unlink
                </Button>
              ) : null}
            </div>
          ))}
          {accountsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading linked accounts…</p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {LINKABLE_PROVIDERS.filter((p) => !linkedProviderIds.has(p.id)).map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  void linkSocialProvider(provider.id).catch((err) => {
                    setError(
                      err instanceof Error ? err.message : `Failed to link ${provider.label}`,
                    );
                  });
                }}
              >
                Link {provider.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Register a device authenticator for phishing-resistant sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Laptop Touch ID (optional)"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              className="sm:max-w-sm"
            />
            <Button onClick={() => addPasskey.mutate()} disabled={addPasskey.isPending}>
              {addPasskey.isPending ? "Waiting for device…" : "Add passkey"}
            </Button>
          </div>
          {(passkeysQuery.data ?? []).length === 0 && !passkeysQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
          ) : null}
          {(passkeysQuery.data ?? []).map((pk) => {
            const label = pk.name || getAuthenticatorName(pk.aaguid) || "Passkey";
            return (
              <div
                key={pk.id}
                className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground">
                    {pk.backedUp ? "Synced" : "Device-bound"}
                    {pk.deviceType ? ` · ${pk.deviceType}` : ""} · added {formatWhen(pk.createdAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deletePasskey.isPending}
                  onClick={() => deletePasskey.mutate(pk.id)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Sessions</CardTitle>
            <CardDescription>Revoke devices you no longer recognize.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            Revoke other sessions
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : null}
          {(sessionsQuery.data ?? []).length === 0 && !sessionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : null}
          {(sessionsQuery.data ?? []).map((row) => {
            const isCurrent = Boolean(currentToken && row.token === currentToken);
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {isCurrent ? "This device" : "Other session"}
                    {isCurrent ? (
                      <Badge className="ml-2" variant="outline">
                        Current
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {row.ipAddress ?? "Unknown IP"}
                    {row.userAgent ? ` · ${row.userAgent}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    Created {formatWhen(row.createdAt)} · expires {formatWhen(row.expiresAt)}
                  </p>
                </div>
                {!isCurrent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeSession.isPending}
                    onClick={() => revokeSession.mutate(row.token)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
