const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled. Try again when you're ready.",
  oauth_error: "The sign-in provider returned an error. Try again in a moment.",
  oauth_callback_error: "We couldn't finish sign-in with the provider. Try again.",
  invalid_code: "The sign-in link expired. Start sign-in again.",
  state_mismatch: "Sign-in session expired. Try GitHub or Google again.",
  email_not_found:
    "We couldn't read an email from your GitHub account. Make sure your GitHub email is public or use magic link instead.",
  account_not_linked:
    "This account is already linked to another sign-in method. Use the original provider or magic link.",
  auth_unreachable: "We couldn't reach the sign-in service. Check your connection and try again.",
  session_unavailable: "We couldn't verify your session. Sign in again to continue.",
  sign_out_failed: "We couldn't sign you out cleanly. Try again or clear site cookies.",
};

export function authErrorMessage(code: string | undefined, fallback?: string) {
  if (!code) return fallback ?? null;
  const normalized = code.toLowerCase().replace(/\s+/g, "_");
  return (
    AUTH_ERROR_MESSAGES[normalized] ?? fallback ?? "Sign-in failed. Try again or use magic link."
  );
}
