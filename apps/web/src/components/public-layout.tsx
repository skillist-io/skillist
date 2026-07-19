import { Link, useRouterState } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { SkillistLogo } from "@/components/skillist-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiUrl } from "@/lib/api-url";
import { signOutAndRedirect, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// Data-dense surfaces run full-bleed like the app shell; marketing pages stay
// centered and measure-capped. The registry and skill-detail (/{org}/{repo},
// the only two-segment public path) are the dense surfaces.
function isFluidRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/registry")) return true;
  return pathname.split("/").filter(Boolean).length === 2;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();

  return (
    <>
      <Button variant="ghost" asChild onClick={onNavigate}>
        <Link to="/registry">Registry</Link>
      </Button>
      <Button variant="ghost" asChild onClick={onNavigate}>
        <a href="https://docs.skillist.io" target="_blank" rel="noreferrer">
          Docs
        </a>
      </Button>
      <Button variant="ghost" asChild onClick={onNavigate}>
        <a href={apiUrl("/docs")} target="_blank" rel="noreferrer">
          API
        </a>
      </Button>
      {session?.user ? (
        <>
          <Button variant="ghost" asChild onClick={onNavigate}>
            <Link to="/dashboard">Dashboard</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onNavigate?.();
              void signOutAndRedirect();
            }}
          >
            Sign out
          </Button>
        </>
      ) : (
        <Button asChild onClick={onNavigate}>
          <Link to="/login" search={{ redirect: undefined }}>
            Sign in
          </Link>
        </Button>
      )}
    </>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fluid = isFluidRoute(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center">
            <SkillistLogo />
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <NavLinks />
          </nav>
          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
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
          <nav className="flex flex-col items-stretch gap-2 px-8 pb-8">
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
      <main className={cn("px-4 py-8 md:px-6", fluid ? "w-full" : "mx-auto max-w-6xl")}>
        {children}
      </main>
      <SiteFooter />
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
      { label: "Dashboard", to: "/dashboard" },
      { label: "Governance", to: "/governance" },
      { label: "Observability", to: "/observability" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Docs", href: "https://docs.skillist.io" },
      { label: "API reference", href: apiUrl("/docs") },
      { label: "CLI", href: "https://docs.skillist.io/cli" },
      { label: "MCP server", href: apiUrl("/mcp") },
    ],
  },
  {
    heading: "Standard",
    links: [
      { label: "agentskills.io", href: "https://agentskills.io" },
      { label: "SKILL.md spec", href: "https://agentskills.io/spec" },
      { label: "Examples", to: "/registry" },
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
        className={cn("grid gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:px-6", width)}
      >
        <div className="flex flex-col gap-4">
          <Link to="/" className="flex w-fit items-center">
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
          <nav key={column.heading} className="flex flex-col gap-3">
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
            <a
              href="https://github.com/skillist"
              target="_blank"
              rel="noreferrer"
              aria-label="Skillist on GitHub"
              className="text-muted-foreground transition-colors hover:text-signal"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              agentskills.io
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
