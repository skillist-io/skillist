import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import {
  sendMagicLink,
  signInWithGitHub,
  signInWithGoogle,
  useSession,
} from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const navigate = useNavigate();
  const { data: session } = useSession();

  if (session?.user) {
    void navigate({ to: redirect ?? "/dashboard" });
  }

  async function handleGitHub() {
    setError(null);
    setLoading("github");
    try {
      await signInWithGitHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub sign-in failed");
      setLoading(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading("google");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(null);
    }
  }

  async function handleMagicLink() {
    setError(null);
    setLoading("magic");
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Sign in to Skillist</h1>
        <p className="text-muted-foreground">
          Passwordless — GitHub, Google, or magic link
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Continue with</CardTitle>
          <CardDescription>
            OAuth via{" "}
            <a
              href="https://better-auth.com/docs/authentication/github"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>{" "}
            or{" "}
            <a
              href="https://better-auth.com/docs/authentication/google"
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Google
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            onClick={handleGitHub}
            disabled={loading !== null}
          >
            {loading === "github" ? "Redirecting…" : "GitHub"}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={handleGoogle}
            disabled={loading !== null}
          >
            {loading === "google" ? "Redirecting…" : "Google"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Magic link</CardTitle>
          <CardDescription>We&apos;ll email you a sign-in link</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            onClick={handleMagicLink}
            disabled={!email || loading !== null}
          >
            {loading === "magic" ? "Sending…" : "Send link"}
          </Button>
          {sent && (
            <p className="text-sm text-green-700">
              Check your email for the sign-in link.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        <Link to="/" className="underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}
