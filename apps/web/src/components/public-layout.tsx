import { Link } from "@tanstack/react-router";
import { apiUrl } from "@/lib/api-url";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut, useSession } from "@/lib/auth-client";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

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
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
