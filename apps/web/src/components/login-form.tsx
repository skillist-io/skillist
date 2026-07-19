import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/ui/page-title";
import { cn } from "@/lib/utils";

type LoginFormProps = Omit<React.ComponentProps<"form">, "onSubmit"> & {
  email: string;
  onEmailChange: (email: string) => void;
  onGitHub: () => void;
  onGoogle: () => void;
  onSso?: () => void;
  onPasskey?: () => void;
  onMagicLink: () => void;
  loading: string | null;
  error: string | null;
  sent: boolean;
};

function GitHubMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
        fill="currentColor"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.01h3.878c2.269-2.09 3.578-5.166 3.578-8.82Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.956-1.075 7.942-2.908l-3.878-3.01c-1.075.72-2.45 1.145-4.064 1.145-3.125 0-5.77-2.11-6.714-4.947H1.276v3.108A11.996 11.996 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.286 14.28A7.213 7.213 0 0 1 4.91 12c0-.79.136-1.558.376-2.28V6.612H1.276A11.996 11.996 0 0 0 0 12c0 1.937.464 3.769 1.276 5.388l4.01-3.108Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.773c1.762 0 3.344.606 4.588 1.795l3.442-3.442C17.951 1.19 15.235 0 12 0A11.996 11.996 0 0 0 1.276 6.612l4.01 3.108C6.23 6.883 8.875 4.773 12 4.773Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function LoginForm({
  className,
  email,
  onEmailChange,
  onGitHub,
  onGoogle,
  onSso,
  onPasskey,
  onMagicLink,
  loading,
  error,
  sent,
  ...props
}: LoginFormProps) {
  const busy = loading !== null;

  return (
    <form
      className={cn("flex flex-col", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onMagicLink();
      }}
      {...props}
    >
      <div className="mb-8 flex flex-col gap-2">
        <PageTitle>Sign in to Skillist</PageTitle>
        <p className="text-sm text-muted-foreground">
          Passwordless access. Pick a provider or use a magic link.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-5 border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* Provider selection — square, full-width, quiet. The active provider
          shows its own state so the choice reads back plainly. */}
      <FieldGroup className="gap-3">
        <Field>
          <Button
            variant="outline"
            type="button"
            className="w-full justify-start gap-3 px-4"
            onClick={onGitHub}
            disabled={busy}
            data-loading={loading === "github" || undefined}
          >
            <GitHubMark />
            <span className="flex-1 text-left">
              {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
            </span>
          </Button>
        </Field>

        <Field>
          <Button
            variant="outline"
            type="button"
            className="w-full justify-start gap-3 px-4"
            onClick={onGoogle}
            disabled={busy}
          >
            <GoogleMark />
            <span className="flex-1 text-left">
              {loading === "google" ? "Redirecting…" : "Continue with Google"}
            </span>
          </Button>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          {onSso ? (
            <Button
              variant="outline"
              type="button"
              className="w-full"
              onClick={onSso}
              disabled={busy}
            >
              {loading === "sso" ? "Redirecting…" : "SSO"}
            </Button>
          ) : null}
          {onPasskey ? (
            <Button
              variant="outline"
              type="button"
              className="w-full"
              onClick={onPasskey}
              disabled={busy}
            >
              {loading === "passkey" ? "Waiting…" : "Passkey"}
            </Button>
          ) : null}
        </div>
      </FieldGroup>

      <div className="my-6 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />
        </Field>

        <Field>
          <Button type="submit" className="w-full" disabled={!email || busy}>
            {loading === "magic" ? "Sending…" : "Send magic link"}
          </Button>
          {sent && (
            <FieldDescription className="text-center font-medium text-foreground">
              Check your email for the sign-in link.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <FieldDescription className="mt-6 text-center">
        By continuing you agree to Skillist&apos;s terms of service.
      </FieldDescription>
    </form>
  );
}
