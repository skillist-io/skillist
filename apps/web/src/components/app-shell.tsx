import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, type ProjectDetail } from "@/lib/api";

type Crumb = { label: string; href?: string; current?: boolean };

function useBreadcrumbs(): Crumb[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segments = pathname.split("/").filter(Boolean);

  // On a project detail route the third segment is a UUID, so resolve the real
  // name from the same query key the detail page uses (dedupes, no extra fetch).
  const onProjectDetail =
    segments[0] === "orgs" && segments[2] === "projects" && segments.length >= 4;
  const orgId = segments[1];
  const projectId = segments[3];
  const { data: project } = useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${orgId}/projects/${projectId}`),
    enabled: onProjectDetail,
  });

  if (segments[0] === "dashboard") {
    return [{ label: "Dashboard", href: "/dashboard", current: true }];
  }

  if (segments[0] === "account") {
    return [{ label: "Account", href: "/account", current: true }];
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

  if (segments[0] === "admin" && segments[1] === "mirrors") {
    return [{ label: "Official mirrors", href: "/admin/mirrors", current: true }];
  }

  if (segments[0] === "governance") {
    return [{ label: "Governance", href: "/governance", current: true }];
  }

  if (segments[0] === "orgs") {
    if (segments[2] === "skills" && segments.length >= 4) {
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: segments[3] ?? "Skill", current: true },
      ];
    }
    if (segments[2] === "projects") {
      if (segments.length >= 4) {
        return [
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects", href: `/orgs/${orgId}/projects` },
          { label: project?.name ?? "Project", current: true },
        ];
      }
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Projects", current: true },
      ];
    }
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
            "--sidebar-width": "17rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset>
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
