import { Link } from "@tanstack/react-router";
import { SkillistLogo } from "@/components/skillist-logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Auth shell — a single calm, centered column. Composure borrowed from
 * engineering-tool sign-in surfaces (generous space, one axis of attention),
 * expressed in the Control Surface voice: literal-white canvas, a faint
 * hairline grid, square geometry, and the signal violet used once as
 * the live indicator. See DESIGN.md.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      {/* Quiet structural backdrop: a hairline grid that reads as ruled paper,
          fading out toward the center so it never competes with the form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5] [mask-image:radial-gradient(120%_90%_at_50%_0%,black,transparent_75%)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-8">
        <Link
          to="/"
          className="flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <SkillistLogo />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            to="/registry"
            className="px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Registry
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[22rem]">{children}</div>
      </main>

      <footer className="relative z-10 flex items-center justify-center gap-2 px-6 py-6">
        <span className="relative flex size-1.5 items-center justify-center">
          <span className="absolute inline-flex size-1.5 animate-ping bg-signal opacity-60 motion-reduce:hidden" />
          <span className="inline-flex size-1.5 bg-signal" />
        </span>
        <p className="text-xs text-muted-foreground">
          Realtime Agent Skills — sub-10ms edge delivery
        </p>
      </footer>
    </div>
  );
}
