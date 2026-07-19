import { CanvasBackdrop, SkillistLogo, ThemeToggle, webUrl } from "@skillist/ui";
import { Link } from "@tanstack/react-router";

/**
 * Auth shell — Better Auth's split-panel sign-in, in the Control Surface voice.
 * A fixed brand column (shared canvas grid, wordmark, a two-tone headline, and
 * honest mono proof points) sits beside the form pane. The brand column is
 * hidden on small screens, where the form centers on its own with the wordmark
 * in the header. Signal violet appears once, as the live indicator. See
 * DESIGN.md.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Brand column — the fixed hero panel. Decorative grid + real proof. */}
      <aside className="panel-noise relative hidden flex-col justify-between overflow-hidden border-r border-border bg-background p-10 lg:flex">
        <CanvasBackdrop className="opacity-60 [mask-image:radial-gradient(120%_100%_at_20%_0%,black,transparent_70%)]" />

        <Link
          to="/"
          className="relative z-10 flex w-fit items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <SkillistLogo />
        </Link>

        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="text-balance font-bold text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.02em] text-foreground">
            Publish once.{" "}
            <span className="text-muted-foreground">Deliver everywhere, in realtime.</span>
          </h2>
          <ul className="flex flex-col gap-3 font-mono text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-flex size-1.5 shrink-0 bg-signal" />
              sub-10ms edge delivery
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-flex size-1.5 shrink-0 bg-muted-foreground/50" />
              works with Claude Code · Cursor · VS Code
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-flex size-1.5 shrink-0 bg-muted-foreground/50" />
              versioned, governed, hosted execution
            </li>
          </ul>
        </div>

        <p className="relative z-10 font-mono text-xs text-muted-foreground">skillist.io</p>
      </aside>

      {/* Form pane */}
      <div className="relative flex flex-col bg-background">
        <header className="flex items-center justify-between px-6 py-5 md:px-8">
          <Link
            to="/"
            className="flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:hidden"
          >
            <SkillistLogo />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <a
              href={webUrl("/registry")}
              className="px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Registry
            </a>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[22rem]">{children}</div>
        </main>

        <footer className="flex items-center justify-center gap-2 px-6 py-6">
          <span className="relative flex size-1.5 items-center justify-center">
            <span className="absolute inline-flex size-1.5 animate-ping bg-signal opacity-60 motion-reduce:hidden" />
            <span className="inline-flex size-1.5 bg-signal" />
          </span>
          <p className="text-xs text-muted-foreground">
            Realtime Agent Skills — sub-10ms edge delivery
          </p>
        </footer>
      </div>
    </div>
  );
}
