import { Link, useRouterState } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-url";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// Data-dense surfaces run full-bleed like the app shell; marketing pages stay
// centered and measure-capped. The registry and skill-detail (/{org}/{repo},
// the only two-segment public path) are the dense surfaces.
function isFluidRoute(pathname: string): boolean {
  if (pathname.startsWith("/registry")) return true;
  return pathname.split("/").filter(Boolean).length === 2;
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fluid = isFluidRoute(pathname);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Zap className="h-5 w-5 text-primary" />
            Skillist
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to="/registry">Registry</Link>
            </Button>
            <Button variant="ghost" asChild>
              <a href="https://docs.skillist.dev" target="_blank" rel="noreferrer">
                Docs
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <a href={apiUrl("/docs")} target="_blank" rel="noreferrer">
                API
              </a>
            </Button>
            {session?.user ? (
              <>
                <Button variant="ghost" asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={() => signOut()}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link to="/login" search={{ redirect: undefined }}>
                  Sign in
                </Link>
              </Button>
            )}
          </nav>
        </div>
      </header>
      <main className={cn("px-4 py-8 md:px-6", fluid ? "w-full" : "mx-auto max-w-6xl")}>
        {children}
      </main>
    </div>
  );
}
