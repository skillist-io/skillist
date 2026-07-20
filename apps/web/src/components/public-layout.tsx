import {
  apiUrl,
  Button,
  ConsentBanner,
  cn,
  consoleUrl,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SkillistLogo,
  signOutAndRedirect,
  ThemeToggle,
  useSession,
} from "@skillist/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, MenuIcon } from "lucide-react";
import { useState } from "react";

// NOTE: the GitHub links (header, mobile menu, footer) were removed. They
// pointed at github.com/skillist, an unrelated org that is not ours, and the
// actual source repo is private. Restore them, with the GitHubMark below, once
// there is a public repo to link to.

// Data-dense surfaces run full-bleed like the app shell; marketing pages stay
// centered and measure-capped. The registry and skill-detail (/{org}/{repo},
// the only two-segment public path) are the dense surfaces.
function isFluidRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/registry")) return true;
  return pathname.split("/").filter(Boolean).length === 2;
}

type NavItem = { label: string; to: string } | { label: string; href: string };

// Registry is an in-app route; Docs and API live on other origins. The nav marks
// that difference so a click's destination is never a surprise.
const PRIMARY_NAV: NavItem[] = [
  { label: "Registry", to: "/registry" },
  { label: "Docs", href: "https://docs.skillist.io" },
  { label: "API", href: apiUrl("/docs") },
];

function PrimaryNav({
  onNavigate,
  orientation = "horizontal",
}: {
  onNavigate?: () => void;
  orientation?: "horizontal" | "vertical";
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const vertical = orientation === "vertical";

  return (
    <>
      {PRIMARY_NAV.map((item) => {
        if ("to" in item) {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Button
              key={item.label}
              variant="ghost"
              asChild
              onClick={onNavigate}
              data-active={active}
              className={cn(
                "text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground",
                vertical && "justify-start",
              )}
            >
              <Link to={item.to}>{item.label}</Link>
            </Button>
          );
        }
        return (
          <Button
            key={item.label}
            variant="ghost"
            asChild
            onClick={onNavigate}
            className={cn("gap-1 text-muted-foreground", vertical && "justify-between")}
          >
            <a href={item.href} target="_blank" rel="noreferrer">
              {item.label}
              <ArrowUpRight className="size-3 opacity-50" aria-hidden="true" />
            </a>
          </Button>
        );
      })}
    </>
  );
}

function AuthActions({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { data: session } = useSession();

  if (session?.user) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild onClick={onNavigate} className={className}>
          <a href={consoleUrl("/dashboard")}>Dashboard</a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={className}
          onClick={() => {
            onNavigate?.();
            // Home, not the shared "/login" default: this app has no /login
            // route (sign-in lives on the console), so the default resolved to
            // skillist.io/login and 404'd. Signing out of a public browsing
            // surface should leave you on it.
            void signOutAndRedirect("/");
          }}
        >
          Sign out
        </Button>
      </>
    );
  }

  return (
    <Button asChild size="sm" onClick={onNavigate} className={className}>
      <a href={consoleUrl("/login")}>Sign in</a>
    </Button>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fluid = isFluidRoute(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only z-[60] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center" aria-label="Skillist home">
            <SkillistLogo />
          </Link>
          <nav className="ml-6 hidden items-center gap-0.5 md:flex lg:ml-10">
            <PrimaryNav />
          </nav>
          <div className="ml-auto hidden items-center gap-0.5 md:flex">
            {/* Kept here although the console's copy moved to Settings: this
                surface is anonymous, so Settings is unreachable and this is the
                only route to the preference. The menu variant offers all three
                choices rather than a binary flip, since there is nowhere else
                to pick "system". */}
            <ThemeToggle variant="menu" />
            <span aria-hidden="true" className="mx-2 h-5 w-px bg-border" />
            <AuthActions />
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <ThemeToggle variant="menu" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              onClick={() => setMobileNavOpen(true)}
            >
              <MenuIcon />
            </Button>
          </div>
        </div>
      </header>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="right" className="w-3/4 sm:max-w-xs">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Skillist navigation</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col items-stretch gap-1 px-8 pb-8">
            <PrimaryNav orientation="vertical" onNavigate={() => setMobileNavOpen(false)} />
            <span aria-hidden="true" className="my-3 h-px w-full bg-border" />
            <AuthActions onNavigate={() => setMobileNavOpen(false)} className="justify-start" />
          </nav>
        </SheetContent>
      </Sheet>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn("px-4 py-8 outline-none md:px-6", fluid ? "w-full" : "mx-auto max-w-6xl")}
      >
        {children}
      </main>
      <SiteFooter />
      <ConsentBanner />
    </div>
  );
}

type FooterColumn = {
  heading: string;
  links: Array<{ label: string; to?: string; href?: string }>;
};

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Registry", to: "/registry" },
      // These three are console routes, not routes of this app. As `to=` they
      // rendered as in-app links that always landed on the 404 component.
      { label: "Dashboard", href: consoleUrl("/dashboard") },
      { label: "Governance", href: consoleUrl("/governance") },
      { label: "Observability", href: consoleUrl("/observability") },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Docs", href: "https://docs.skillist.io" },
      { label: "API reference", href: apiUrl("/docs") },
      { label: "CLI", href: "https://docs.skillist.io/getting-started/cli/" },
      { label: "MCP server", href: apiUrl("/mcp") },
    ],
  },
  {
    heading: "Standard",
    links: [
      { label: "agentskills.io", href: "https://agentskills.io" },
      { label: "SKILL.md spec", href: "https://agentskills.io/spec" },
      { label: "Examples", to: "/registry" },
      { label: "Privacy", to: "/privacy" },
    ],
  },
];

function FooterLink({ link }: { link: FooterColumn["links"][number] }) {
  const className =
    "text-sm text-muted-foreground transition-colors hover:text-signal focus-visible:text-signal focus-visible:outline-none";
  if (link.to) {
    return (
      <Link to={link.to} className={className}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} target="_blank" rel="noreferrer" className={className}>
      {link.label}
    </a>
  );
}

function SiteFooter() {
  // The footer is a deliberate band: always measure-capped, even under
  // full-bleed (fluid) content, so it reads as anchored rather than stretched.
  const width = "mx-auto max-w-6xl";
  return (
    <footer className="mt-20 border-t border-border">
      <div
        className={cn(
          "grid gap-y-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-x-8 md:px-6",
          width,
        )}
      >
        <div className="flex flex-col gap-4">
          <Link to="/" className="flex w-fit items-center" aria-label="Skillist home">
            <SkillistLogo />
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            The realtime registry for Agent Skills. Publish, version, govern, and deliver SKILL.md
            with sub-10ms edge fan-out.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="relative flex size-1.5 items-center justify-center">
              <span className="absolute inline-flex size-1.5 animate-ping bg-signal opacity-60 motion-reduce:hidden" />
              <span className="inline-flex size-1.5 bg-signal" />
            </span>
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              All systems live
            </span>
          </div>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav
            key={column.heading}
            className="flex flex-col gap-3 md:border-l md:border-border md:pl-8"
          >
            <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {column.heading}
            </h2>
            {column.links.map((link) => (
              <FooterLink key={link.label} link={link} />
            ))}
          </nav>
        ))}
      </div>

      <div className="border-t border-border">
        <div
          className={cn(
            "flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-6",
            width,
          )}
        >
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Skillist. Built on Cloudflare Workers.
          </p>
          <div className="flex items-center gap-5">
            {/* Honest signals, machine-voice — Skillist implements the spec and
                delivers from the edge. No unearned compliance badges. */}
            <span className="hidden font-mono text-[0.65rem] text-muted-foreground sm:inline">
              sub-10ms edge delivery
            </span>
            <a
              href="https://agentskills.io"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              agentskills.io compliant
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
