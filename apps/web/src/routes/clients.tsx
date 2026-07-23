import { RuleEdge, SignalField, signalFieldClass } from "@skillist/ui";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { CLIENTS, type ClientData } from "@/components/clients-data";

export const Route = createFileRoute("/clients")({
  component: ClientsPage,
});

/**
 * A theme-swapped vendor logo. Two fixed images rather than one adaptive SVG
 * because these are third-party marks shipped exactly as their owners cut
 * them; recolouring them to currentColor is not ours to do.
 */
function ClientLogo({ client }: { client: ClientData }) {
  const height = `${2.5 * (client.scale ?? 1)}rem`;
  return (
    <span className="flex h-12 items-center">
      <img
        src={`/clients/${client.slug}-light.${client.ext}`}
        alt=""
        loading="lazy"
        style={{ height }}
        className="w-auto max-w-44 object-contain dark:hidden"
      />
      <img
        src={`/clients/${client.slug}-dark.${client.ext}`}
        alt=""
        loading="lazy"
        style={{ height }}
        className="hidden w-auto max-w-44 object-contain dark:block"
      />
    </span>
  );
}

function CellLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

function ClientCell({ client }: { client: ClientData }) {
  return (
    <div className="flex flex-col gap-3 bg-background p-6">
      <ClientLogo client={client} />
      <a
        href={client.url}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-1 text-sm font-semibold text-foreground"
      >
        {client.name}
        <ArrowUpRight
          className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        />
      </a>
      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{client.description}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {client.instructionsUrl && (
          <CellLink href={client.instructionsUrl}>Setup instructions</CellLink>
        )}
        {client.sourceCodeUrl && <CellLink href={client.sourceCodeUrl}>Source code</CellLink>}
        {client.skillistOrg && (
          <CellLink href={`/registry?org=${client.skillistOrg}`}>Skills on Skillist</CellLink>
        )}
      </div>
    </div>
  );
}

function ClientsPage() {
  return (
    <div className="flex flex-col">
      {/* Hero — the same dark band as the landing (Dark Hero Exception,
          DESIGN.md §2). Negative margins cancel main's padding for the
          full-bleed band; the inner wrapper restores the inset. */}
      <section className="dark panel-noise relative -mx-4 -mt-8 overflow-hidden border-b border-border bg-background text-foreground md:-mx-6">
        <SignalField className={signalFieldClass} />
        <div className="px-4 md:px-6">
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 px-1 py-20 md:py-24">
            <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <span className="inline-flex size-1.5 bg-signal" aria-hidden />
              Clients
            </span>
            <h1 className="text-balance text-hero text-foreground">Runs where your agents run</h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              Skills published on Skillist follow the open{" "}
              <a
                href="https://agentskills.io"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                agentskills.io
              </a>{" "}
              format, so every agent product below can load them. Publish once, deliver to any of
              them.
            </p>
          </div>
        </div>
      </section>

      {/* The roster. Hairline-divided grid (gap-px over a border ground), not
          bordered cards — the divider is structure, not chrome. */}
      <section className="mx-auto w-full max-w-6xl px-1 py-16">
        <div className="flex flex-col gap-2">
          <h2 className="text-headline text-foreground">Agent products that support the format</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            The most widely used clients, alphabetically. Where a product publishes its own skills
            or setup guide, it is linked.
          </p>
        </div>
        <div className="relative mt-8 grid gap-px bg-border sm:grid-cols-2">
          <RuleEdge />
          {CLIENTS.map((client) => (
            <ClientCell key={client.slug} client={client} />
          ))}
        </div>
        <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
          This is a curated selection. Every client that supports the format is listed at{" "}
          <a
            href="https://agentskills.io/clients"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            agentskills.io/clients
          </a>
          . Building an agent product? The format is open:{" "}
          <a
            href="https://agentskills.io"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            start at agentskills.io
          </a>
          .
        </p>
      </section>
    </div>
  );
}
