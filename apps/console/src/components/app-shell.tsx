import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  CanvasBackdrop,
  canvasBackdropClass,
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@skillist/ui";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { prefetchAgentChat } from "@/components/agent/agent-chat-lazy";
import { AgentDrawer, useAgentDrawer } from "@/components/agent/agent-drawer";
import { AppSidebar } from "@/components/app-sidebar";
import { OrgSwitcher } from "@/components/org-switcher";
import { ActiveOrgProvider } from "@/lib/active-org";
import { useBreadcrumbs } from "@/lib/breadcrumbs";

export function AppShell({ children }: { children: React.ReactNode }) {
  const crumbs = useBreadcrumbs();
  const agentDrawer = useAgentDrawer();

  return (
    <TooltipProvider>
      {/* Global active-org context — wraps children AND the AgentDrawer so the
          top-bar switcher, every route, and the agent all read one org. */}
      <ActiveOrgProvider>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "17rem",
            } as React.CSSProperties
          }
        >
          <AppSidebar />
          {/* isolate: own stacking context so the -z-10 CanvasBackdrop paints
            above this pane's bg-background instead of escaping behind it. */}
          {/* panel-noise: dark-mode grain over the whole product surface, in the
            same decorative layer as the grid below. One edit covers every route. */}
          <SidebarInset className="panel-noise isolate">
            {/* Shared canvas — the same hairline grid as the homepage hero, so the
              product surface reads as the same instrument. Behind all content.
              Deliberately the STATIC grid, not <SignalField>: the workspace is
              read for hours, and perpetual motion here would both cost attention
              on every screen and spend the signal violet on decoration, leaving
              a real fan-out competing with wallpaper for the same colour. Motion
              belongs on the surfaces you pass through — the hero and sign-in. */}
            <CanvasBackdrop className={`-z-10 ${canvasBackdropClass}`} />
            <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.label} className="contents">
                      {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                      <BreadcrumbItem className={index === 0 ? "hidden md:block" : undefined}>
                        {crumb.current ? (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link to={crumb.href!}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </span>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto flex items-center gap-1">
                <OrgSwitcher />
                <Separator
                  orientation="vertical"
                  className="mx-1 data-[orientation=vertical]:h-4"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => agentDrawer.setOpen(true)}
                      // Warm the agent chunk on intent, so the drawer usually has
                      // it in cache by the time it opens.
                      onPointerEnter={prefetchAgentChat}
                      onFocus={prefetchAgentChat}
                      aria-label="Ask the Skillist agent"
                      aria-keyshortcuts="Meta+K Control+K"
                    >
                      <Bot className="size-4" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Ask the agent <kbd className="ml-1 font-mono text-[0.6875rem]">⌘K</kbd>
                  </TooltipContent>
                </Tooltip>
                <ThemeToggle />
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
          </SidebarInset>
          {/* Mounted once at the shell so the agent is reachable from every route
            and keeps its connection across navigation. */}
          <AgentDrawer open={agentDrawer.open} onOpenChange={agentDrawer.setOpen} />
        </SidebarProvider>
      </ActiveOrgProvider>
    </TooltipProvider>
  );
}
