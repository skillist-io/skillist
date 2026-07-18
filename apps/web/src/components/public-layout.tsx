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
        <a href="https://docs.skillist.dev" target="_blank" rel="noreferrer">
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
    </div>
  );
}
