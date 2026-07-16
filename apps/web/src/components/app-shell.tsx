import { Link, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";

function useBreadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "dashboard") {
    return [{ label: "Dashboard", href: "/dashboard", current: true }];
  }

  if (segments[0] === "settings") {
    return [{ label: "Settings", href: "/settings", current: true }];
  }

  if (segments[0] === "inventory") {
    return [{ label: "Inventory", href: "/inventory", current: true }];
  }

  if (segments[0] === "observability") {
    return [{ label: "Observability", href: "/observability", current: true }];
  }

  if (segments[0] === "orgs" && segments.length >= 4) {
    return [
      { label: "Dashboard", href: "/dashboard" },
      { label: segments[3], current: true },
    ];
  }

  return [{ label: "Skillist", href: "/dashboard", current: true }];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const crumbs = useBreadcrumbs();

  return (
    <TooltipProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "350px",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-background p-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {crumbs.map((crumb, index) => (
                  <span key={crumb.label} className="contents">
                    {index > 0 && (
                      <BreadcrumbSeparator className="hidden md:block" />
                    )}
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
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
