import { Link } from "@tanstack/react-router";
import { SkillistLogo } from "@/components/skillist-logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center">
            <SkillistLogo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <div className="absolute inset-0 flex flex-col justify-center gap-4 p-10">
          <h2 className="text-3xl font-semibold tracking-tight">Realtime Agent Skills</h2>
          <p className="max-w-md text-muted-foreground">
            Manage, version, and deliver SKILL.md files with sub-10ms fan-out. Built for the
            agentskills.io standard.
          </p>
        </div>
      </div>
    </div>
  );
}
