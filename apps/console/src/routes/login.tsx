import {
  isSameSitePath,
  sendMagicLink,
  signInWithGitHub,
  signInWithGoogle,
  signInWithPasskey,
  signInWithSso,
  useSession,
} from "@skillist/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { LoginForm } from "@/components/login-form";
import { authErrorMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    // Sanitize at the boundary so every downstream use (router navigate + the
    // sign-in callbackURLs) is same-site only. A crafted ?redirect=https://evil
    // otherwise bounces a just-signed-in user to a phishing page.
    redirect: z
      .string()
      .optional()
      .transform((v) => (v && isSameSitePath(v) ? v : undefined)),
    error: z.string().optional(),
    error_description: z.string().optional(),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect, error: authError, error_description: authErrorDescription } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    const message = authErrorMessage(authError, authErrorDescription);
    if (message) setError(message);
  }, [authError, authErrorDescription]);

  useEffect(() => {
    if (session?.user) {
      void navigate({ to: redirect ?? "/dashboard", replace: true });
    }
  }, [session?.user, redirect, navigate]);

  if (session?.user) {
    return null;
  }

  async function handleGitHub() {
    setError(null);
    setLoading("github");
    try {
      await signInWithGitHub(redirect ?? "/dashboard");
    } catch (err) {
      setError(
        authErrorMessage("oauth_error", err instanceof Error ? err.message : undefined) ??
          "GitHub sign-in failed",
      );
      setLoading(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading("google");
    try {
      await signInWithGoogle(redirect ?? "/dashboard");
    } catch (err) {
      setError(
        authErrorMessage("oauth_error", err instanceof Error ? err.message : undefined) ??
          "Google sign-in failed",
      );
      setLoading(null);
    }
  }

  async function handleMagicLink() {
    setError(null);
    setLoading("magic");
    try {
      await sendMagicLink(email, redirect ?? "/dashboard");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send sign-in link");
    } finally {
      setLoading(null);
    }
  }

  async function handleSso() {
    setError(null);
    setLoading("sso");
    try {
      await signInWithSso(redirect ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO sign-in failed");
      setLoading(null);
    }
  }

  async function handlePasskey() {
    setError(null);
    setLoading("passkey");
    try {
      await signInWithPasskey(redirect ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed");
      setLoading(null);
    }
  }

  return (
    <>
      <LoginForm
        email={email}
        onEmailChange={setEmail}
        onGitHub={handleGitHub}
        onGoogle={handleGoogle}
        onSso={handleSso}
        onPasskey={handlePasskey}
        onMagicLink={handleMagicLink}
        loading={loading}
        error={error}
        sent={sent}
      />
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Link to="/" className="underline">
          Back to home
        </Link>
      </p>
    </>
  );
}
