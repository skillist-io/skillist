import { useEffect, useState } from "react";
import { Button } from "..";
import { type ConsentChoice, readConsent, setConsent } from "../lib/analytics";

/**
 * Cookie consent banner, wired to Google Consent Mode v2.
 *
 * Hand-built rather than pulling in a CMP SDK: the behaviour is a stored choice
 * plus a dataLayer push, and a third-party CMP would be both heavier and
 * off-brand. Shared across web, console, and docs so the decision is made once
 * and the cookie is scoped to .skillist.io.
 *
 * Consent defaults to denied in the GTM bootstrap (see gtm-plugin), so no
 * analytics storage is used before an explicit grant — this component only ever
 * sends the update.
 */
export function ConsentBanner() {
  // null = undecided (or SSR/no-JS). Rendering nothing until mount avoids a
  // flash of the banner for visitors who already chose.
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);

  useEffect(() => {
    const stored = readConsent();
    setChoice(stored);
    // Replay a stored grant so Consent Mode reflects it on this page load too;
    // the default set in the bootstrap is denied on every load.
    if (stored === "granted") setConsent("granted");
  }, []);

  if (choice !== null) return null;

  const decide = (next: ConsentChoice) => {
    setConsent(next);
    setChoice(next);
  };

  return (
    <div
      // Not a modal: it must not trap focus or block the page. A developer
      // landing here to read docs should be able to ignore it entirely.
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <p className="text-sm text-muted-foreground">
          We use Google Analytics to understand how Skillist is used. No advertising cookies, ever.{" "}
          <a
            href="https://skillist.io/privacy"
            className="text-foreground underline underline-offset-4 hover:text-signal"
          >
            Privacy
          </a>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => decide("denied")}>
            Decline
          </Button>
          <Button size="sm" onClick={() => decide("granted")}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
