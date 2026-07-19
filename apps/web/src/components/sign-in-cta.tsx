import { Button } from "@skillist/ui";

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "https://console.skillist.io";

/**
 * Public-site stand-in for authenticated actions (e.g. "add to a project").
 * Project management lives in the console; this sends the visitor there to sign
 * in rather than shipping the authed widget on the marketing site. Accepts (and
 * ignores) the AddToProjectButton props so it can drop in as an alias.
 */
export function SignInToAddButton(_props: {
  target?: unknown;
  variant?: string;
  size?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <Button variant="outline" size="sm" asChild className={_props.className}>
      <a href={`${CONSOLE_URL}/login`}>Add to project</a>
    </Button>
  );
}
