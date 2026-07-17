import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  LayoutDashboard,
  type LucideIcon,
  PackageSearch,
  Settings2,
  Shield,
  Zap,
} from "lucide-react";
import * as React from "react";
import { NavUser } from "@/components/nav-user";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { api, type Org, type Skill } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

type NavItem = {
  title: string;
  to: string;
  icon: LucideIcon;
  section: "dashboard" | "inventory" | "observability" | "governance" | "settings";
};

const navMain: NavItem[] = [
  {
    title: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    section: "dashboard",
  },
  {
    title: "Inventory",
    to: "/inventory",
    icon: PackageSearch,
    section: "inventory",
  },
  {
    title: "Observability",
    to: "/observability",
    icon: Activity,
    section: "observability",
  },
  {
    title: "Governance",
    to: "/governance",
    icon: Shield,
    section: "governance",
  },
  {
    title: "Settings",
    to: "/settings",
    icon: Settings2,
    section: "settings",
  },
];

function activeSection(pathname: string): NavItem["section"] {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/governance")) return "governance";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/inventory")) return "inventory";
  return "dashboard";
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = activeSection(pathname);
  const activeItem = navMain.find((item) => item.section === section) ?? navMain[0]!;
  const { open } = useSidebar();
  const { data: session } = useSession();
  const [filter, setFilter] = React.useState("");
  const [privateOnly, setPrivateOnly] = React.useState(false);

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const user = {
    name: session?.user?.name ?? "User",
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  };

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      <Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
                <Link to="/dashboard">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Zap className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Skillist</span>
                    <span className="truncate text-xs">Agent Skills</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                {navMain.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{ children: item.title, hidden: false }}
                      asChild
                      isActive={activeItem.title === item.title}
                      className="px-2.5 md:px-2"
                    >
                      <Link to={item.to}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={user} />
        </SidebarFooter>
      </Sidebar>

      {open ? (
        <Sidebar collapsible="none" className="hidden flex-1 md:flex">
          <SidebarHeader className="gap-3.5 border-b p-4">
            <div className="flex w-full items-center justify-between">
              <div className="text-base font-medium text-foreground">{activeItem.title}</div>
              <Label htmlFor="sidebar-private-only" className="flex items-center gap-2 text-sm">
                <span>Private only</span>
                <Switch
                  id="sidebar-private-only"
                  className="shadow-none"
                  checked={privateOnly}
                  onCheckedChange={setPrivateOnly}
                />
              </Label>
            </div>
            <SidebarInput
              placeholder="Filter orgs and skills..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="px-0">
              <SidebarGroupContent>
                <OrgSkillNav
                  orgs={orgs ?? []}
                  filter={filter}
                  privateOnly={privateOnly}
                  pathname={pathname}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      ) : null}
    </Sidebar>
  );
}

function OrgSkillNav({
  orgs,
  filter,
  privateOnly,
  pathname,
}: {
  orgs: Org[];
  filter: string;
  privateOnly: boolean;
  pathname: string;
}) {
  const needle = filter.trim().toLowerCase();

  if (!orgs.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No organizations yet. Create one on the dashboard.
      </p>
    );
  }

  const orgBlocks = orgs
    .filter(
      (org) =>
        !needle ||
        org.name.toLowerCase().includes(needle) ||
        org.slug.toLowerCase().includes(needle),
    )
    .map((org) => (
      <OrgSkills
        key={org.id}
        org={org}
        filter={needle}
        privateOnly={privateOnly}
        pathname={pathname}
      />
    ))
    .filter(Boolean);

  if (!orgBlocks.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {privateOnly ? "No private skills match your filters." : "No skills match your filters."}
      </p>
    );
  }

  return <>{orgBlocks}</>;
}

function OrgSkills({
  org,
  filter,
  privateOnly,
  pathname,
}: {
  org: Org;
  filter: string;
  privateOnly: boolean;
  pathname: string;
}) {
  const { data: skills } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
  });

  const visibleSkills =
    skills?.filter((skill) => {
      if (privateOnly && skill.visibility !== "private") return false;
      if (
        filter &&
        !skill.repo.toLowerCase().includes(filter) &&
        !org.slug.toLowerCase().includes(filter)
      ) {
        return false;
      }
      return true;
    }) ?? [];

  if (!visibleSkills.length) {
    if (privateOnly) return null;
    if (
      filter &&
      !org.slug.toLowerCase().includes(filter) &&
      !org.name.toLowerCase().includes(filter)
    ) {
      return null;
    }
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {org.name}
      </div>
      {visibleSkills.length ? (
        visibleSkills.map((skill) => {
          const href = `/orgs/${org.id}/skills/${skill.repo}`;
          const active = pathname === href;
          return (
            <Link
              key={skill.id}
              to="/orgs/$orgId/skills/$repo"
              params={{ orgId: org.id, repo: skill.repo }}
              className={`flex flex-col items-start gap-1 px-4 py-3 text-sm leading-tight hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
              }`}
            >
              <span className="font-medium">{skill.repo}</span>
              <span className="text-xs text-muted-foreground">{skill.visibility}</span>
            </Link>
          );
        })
      ) : (
        <p className="px-4 pb-3 text-xs text-muted-foreground">No skills yet</p>
      )}
    </div>
  );
}
