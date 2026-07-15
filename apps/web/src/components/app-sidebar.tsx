import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Settings2,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
  section: "dashboard" | "settings";
};

const navMain: NavItem[] = [
  {
    title: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    section: "dashboard",
  },
  {
    title: "Settings",
    to: "/settings",
    icon: Settings2,
    section: "settings",
  },
];

const settingsLinks = [
  { title: "OAuth setup", href: "#github-oauth" },
  { title: "API keys", href: "#api-keys" },
];

function activeSection(pathname: string): NavItem["section"] {
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = activeSection(pathname);
  const activeItem = navMain.find((item) => item.section === section) ?? navMain[0]!;
  const { setOpen } = useSidebar();
  const { data: session } = useSession();
  const [filter, setFilter] = React.useState("");

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
    enabled: section === "dashboard",
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
                      onClick={() => setOpen(true)}
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

      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarHeader className="gap-3.5 border-b p-4">
          <div className="flex w-full items-center justify-between">
            <div className="text-base font-medium text-foreground">
              {activeItem.title}
            </div>
            {section === "dashboard" && (
              <Label className="flex items-center gap-2 text-sm">
                <span>Private only</span>
                <Switch className="shadow-none" />
              </Label>
            )}
          </div>
          {section === "dashboard" && (
            <SidebarInput
              placeholder="Filter orgs and skills..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="px-0">
            <SidebarGroupContent>
              {section === "dashboard" ? (
                <OrgSkillNav orgs={orgs ?? []} filter={filter} pathname={pathname} />
              ) : (
                settingsLinks.map((link) => (
                  <a
                    key={link.title}
                    href={link.href}
                    className="flex flex-col items-start gap-1 border-b p-4 text-sm leading-tight last:border-b-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <span className="font-medium">{link.title}</span>
                  </a>
                ))
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  );
}

function OrgSkillNav({
  orgs,
  filter,
  pathname,
}: {
  orgs: Org[];
  filter: string;
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

  return (
    <>
      {orgs
        .filter(
          (org) =>
            !needle ||
            org.name.toLowerCase().includes(needle) ||
            org.slug.toLowerCase().includes(needle),
        )
        .map((org) => (
          <OrgSkills key={org.id} org={org} filter={needle} pathname={pathname} />
        ))}
    </>
  );
}

function OrgSkills({
  org,
  filter,
  pathname,
}: {
  org: Org;
  filter: string;
  pathname: string;
}) {
  const { data: skills } = useQuery({
    queryKey: ["skills", org.id],
    queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
  });

  const visibleSkills =
    skills?.filter(
      (skill) =>
        !filter ||
        skill.slug.toLowerCase().includes(filter) ||
        org.slug.toLowerCase().includes(filter),
    ) ?? [];

  if (filter && !visibleSkills.length && !org.slug.includes(filter) && !org.name.toLowerCase().includes(filter)) {
    return null;
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {org.name}
      </div>
      {visibleSkills.length ? (
        visibleSkills.map((skill) => {
          const href = `/orgs/${org.id}/skills/${skill.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={skill.id}
              to="/orgs/$orgId/skills/$slug"
              params={{ orgId: org.id, slug: skill.slug }}
              className={`flex flex-col items-start gap-1 px-4 py-3 text-sm leading-tight hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
              }`}
            >
              <span className="font-medium">{skill.slug}</span>
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
