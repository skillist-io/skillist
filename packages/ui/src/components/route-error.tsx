import type { ErrorComponentProps } from "@tanstack/react-router";
import { isRedirect, useRouter } from "@tanstack/react-router";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "..";
import { consoleUrl } from "../lib/urls";

function describeError(error: unknown): {
  title: string;
  message: string;
  showSignIn: boolean;
} {
  if (isRedirect(error)) {
    return {
      title: "Redirecting",
      message: "Taking you to the next page…",
      showSignIn: false,
    };
  }

  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  if (/failed to fetch|network|load failed/i.test(message)) {
    return {
      title: "Could not reach Skillist",
      message:
        "We couldn't connect to the API. Check your network, then try again. If you were signing in, use the button below to retry GitHub or Google.",
      showSignIn: true,
    };
  }

  if (/unauthorized|401|session|sign in/i.test(message)) {
    return {
      title: "Sign in required",
      message: "Your session expired or isn't available. Sign in again to continue.",
      showSignIn: true,
    };
  }

  return {
    title: "Something went wrong",
    message,
    showSignIn: false,
  };
}

export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { title, message, showSignIn } = describeError(error);
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center bg-destructive/10 text-destructive">
            <AlertCircle className="size-5" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => reset()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Button type="button" variant="outline" onClick={() => void router.navigate({ to: "/" })}>
            Go home
          </Button>
          {showSignIn ? (
            <Button type="button" variant="outline" asChild>
              <a href={consoleUrl("/login")}>Sign in</a>
            </Button>
          ) : null}
        </CardContent>
        {import.meta.env.DEV ? (
          <CardContent>
            <pre className="max-h-48 overflow-auto bg-muted p-3 text-xs whitespace-pre-wrap">
              {detail}
            </pre>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
