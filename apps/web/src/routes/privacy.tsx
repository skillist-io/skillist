import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/public-layout";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

/**
 * Privacy policy.
 *
 * Deliberately specific: it names the actual tables, cookies, and third-party
 * processors rather than reciting boilerplate, because a developer audience
 * will check. Every claim here is traceable to code — if data handling changes,
 * this page changes with it.
 *
 * NOT legal advice and not reviewed by a lawyer. It describes current
 * behaviour accurately; a formal review is still warranted before any
 * enterprise commitment.
 */
function PrivacyPage() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 md:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 20 July 2026</p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed">
          <Section title="Who runs Skillist">
            <p>
              Skillist is operated by an individual developer, not an incorporated company. For any
              privacy question, or to request access to or deletion of your data, email{" "}
              <Mail to="privacy@skillist.io" />.
            </p>
          </Section>

          <Section title="What we collect">
            <p className="mb-4">
              Only what the product needs to work. There is no advertising, no data brokerage, and
              no sale of personal information.
            </p>
            <Table
              head={["Data", "Why", "Where"]}
              rows={[
                [
                  "Email address, display name, avatar",
                  "Your account. Supplied by GitHub or Google when you sign in with them, or entered by you for a magic link.",
                  "Neon Postgres (US East)",
                ],
                [
                  "Session records, including IP address and user agent",
                  "Keeping you signed in, and letting you see and revoke active sessions.",
                  "Neon Postgres",
                ],
                [
                  "Passkey public keys",
                  "Passwordless sign-in. Private keys never leave your device.",
                  "Neon Postgres",
                ],
                [
                  "Organisations, skills, versions, and bundle contents you publish",
                  "The product itself.",
                  "Neon Postgres + Cloudflare R2",
                ],
                [
                  "Install and activation events",
                  "Registry rankings and your org's coverage reporting. Recorded against your org, not your browsing.",
                  "Neon Postgres",
                ],
                [
                  "Skill run output (stdout/stderr)",
                  "Showing you the result of a sandbox run. This is whatever your skill's scripts print — treat it as yours, and avoid printing secrets.",
                  "Neon Postgres",
                ],
                [
                  "Audit events",
                  "Security. Records who performed privileged actions such as creating an API key or making a skill public.",
                  "Neon Postgres",
                ],
              ]}
            />
          </Section>

          <Section title="Cookies">
            <Table
              head={["Cookie", "Purpose"]}
              rows={[
                [
                  "Better Auth session",
                  "Keeps you signed in. Strictly necessary. Scoped to .skillist.io so one sign-in covers the site and the console.",
                ],
                ["skillist-theme", "Remembers light/dark preference. Strictly necessary."],
                [
                  "skillist-consent",
                  "Remembers whether you accepted analytics, so we stop asking.",
                ],
                ["_ga / _ga_*", "Google Analytics. Set only after you accept — see below."],
              ]}
            />
          </Section>

          <Section title="Analytics">
            <p>
              We use Google Analytics 4 to understand which pages people find useful. It is loaded
              through Google Tag Manager with{" "}
              <span className="font-mono text-xs">analytics_storage</span> denied by default, so no
              analytics cookie is set until you press Accept. Declining is respected and we do not
              ask again.
            </p>
            <p className="mt-4">
              Google&rsquo;s advertising signals —{" "}
              <span className="font-mono text-xs">ad_storage</span>,{" "}
              <span className="font-mono text-xs">ad_user_data</span>, and{" "}
              <span className="font-mono text-xs">ad_personalization</span> — are permanently
              denied. Skillist does not advertise and does not share data with ad platforms.
            </p>
          </Section>

          <Section title="Who else processes your data">
            <p className="mb-4">
              We use infrastructure providers as sub-processors. They store or transmit data on our
              behalf under their own terms.
            </p>
            <Table
              head={["Provider", "Role"]}
              rows={[
                [
                  "Cloudflare",
                  "Hosting, edge delivery, bundle storage (R2), sandboxed skill execution",
                ],
                ["Neon", "Managed Postgres (US East)"],
                ["GitHub / Google", "OAuth sign-in, only if you choose those methods"],
                ["Google", "Analytics, only with your consent"],
                ["Anthropic / Cloudflare Workers AI", "AI-drafted skill improvements and evals"],
              ]}
            />
            <p className="mt-4">
              Skill content sent for AI-drafted improvements is processed to produce that draft. Do
              not put secrets in skill bundles.
            </p>
          </Section>

          <Section title="Retention">
            <p>
              Account data is kept while your account exists. Audit events are retained for security
              and are intentionally not deleted when other data is, so that a record of privileged
              actions survives. Automated pruning of session, run, and telemetry records is being
              introduced; until then those rows are retained indefinitely, and we would rather say
              so than imply a schedule we do not yet enforce.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You can ask for a copy of your data, correction, or deletion by emailing{" "}
              <Mail to="privacy@skillist.io" />. Self-service account deletion is not built yet, so
              requests are handled manually — we will confirm when it is done. If you are in the UK
              or EU, you also have the right to complain to your data protection authority.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              If this policy changes materially we will update the date above and, for anything
              affecting how your data is used, say so in the changelog rather than changing it
              quietly.
            </p>
          </Section>
        </div>
      </div>
    </PublicLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}

function Mail({ to }: { to: string }) {
  return (
    <a
      href={`mailto:${to}`}
      className="font-mono text-xs text-foreground underline underline-offset-4 hover:text-signal"
    >
      {to}
    </a>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-semibold tracking-wide text-foreground uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-border last:border-0">
              {row.map((cell, i) => (
                <td
                  key={cell}
                  className={
                    i === 0 ? "px-3 py-2 align-top text-foreground" : "px-3 py-2 align-top"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
