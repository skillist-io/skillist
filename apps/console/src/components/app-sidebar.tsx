import type { TreeNode } from "@skillist/ui";
import {
  api,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  type Org,
  type Project,
  type ProjectDetail,
  type ProjectItem,
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
  type Skill,
  SkillistLogo,
  SkillistMark,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useSession,
  useSidebar,
  webUrl,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  PackageSearch,
  Plus,
  Settings2,
  Shield,
  Target,
} from "lucide-react";
import * as React from "react";
import { NavUser } from "@/components/nav-user";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectVisibilityIcon } from "@/components/project-visibility";
import { buildProjectTree, projectItemLeafName } from "@/lib/project-tree";
import { useAutoExpand } from "@/lib/use-auto-expand";

type NavItem = {
  title: string;
  to: string;
  icon: LucideIcon;
  section:
    | "dashboard"
    | "agent"
    | "inventory"
    | "observability"
    | "coverage"
    | "governance"
    | "mirrors"
    | "settings";
};

const navMain: NavItem[] = [
  {
    title: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    section: "dashboard",
  },
  {
    title: "Agent",
    to: "/agent",
    icon: Bot,
    section: "agent",
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
    title: "Coverage",
    to: "/coverage",
    icon: Target,
    section: "coverage",
  },
  {
    title: "Governance",
    to: "/governance",
    icon: Shield,
    section: "governance",
  },
  {
    title: "Mirrors",
    to: "/admin/mirrors",
    icon: GitBranch,
    section: "mirrors",
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
  if (pathname.startsWith("/admin/mirrors")) return "mirrors";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/coverage")) return "coverage";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/agent")) return "agent";
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
              <SidebarMenuButton
                size="lg"
                asChild
                className="md:h-8 md:p-0"
                tooltip={{ children: "Skillist — Dashboard", hidden: false }}
              >
                <Link to="/dashboard">
                  {/* The socket stamp in the icon-width rail: a squared ink tile
                      with the paper aperture knocked out (SkillistMark carries
                      the shared geometry). The wordmark below carries the
                      accessible name. */}
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center bg-foreground text-background"
                  >
                    <SkillistMark className="size-8" />
                  </span>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <SkillistLogo className="truncate text-sm" />
                    <span className="truncate text-xs text-muted-foreground">Agent Skills</span>
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
            <SkillistLogo />
            {/* The lock sits with the search box because they do the same job —
                both narrow this tree. It also keeps it off the panel's right
                edge, where it landed next to the sidebar collapse trigger and
                the two icon buttons read as a pair despite being unrelated.

                The lock *is* the control rather than a label beside a switch:
                one binary needs one affordance, and a switch earns its width
                only when the states need naming. aria-pressed carries the
                on/off the switch used to; the tooltip names it. */}
            <div className="flex items-center gap-2">
              <SidebarInput
                className="flex-1"
                placeholder="Filter orgs and skills..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-pressed={privateOnly}
                    aria-label="Show only private skills"
                    onClick={() => setPrivateOnly((v) => !v)}
                  >
                    <Lock
                      className={cn(
                        "size-4 transition-colors",
                        privateOnly ? "text-signal" : "text-muted-foreground",
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {privateOnly ? "Showing private skills only" : "Show only private skills"}
                </TooltipContent>
              </Tooltip>
            </div>
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
      <OrgBlock
        key={org.id}
        org={org}
        orgs={orgs}
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

function OrgBlock({
  org,
  orgs,
  filter,
  privateOnly,
  pathname,
}: {
  org: Org;
  orgs: Org[];
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
      {/* Projects axis: curated trees. Private-only is a skills-focused view, so
          curation is hidden while it's engaged. */}
      {!privateOnly && (
        <OrgProjectsSection org={org} orgs={orgs} filter={filter} pathname={pathname} />
      )}
      <div className="pb-1">
        <div className="px-4 pt-1 pb-1 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Skills
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
                className={cn(
                  "flex flex-col items-start gap-1 px-4 py-3 text-sm leading-tight hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active &&
                    "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_currentColor]",
                )}
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
    </div>
  );
}

function OrgProjectsSection({
  org,
  orgs,
  filter,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  filter: string;
  pathname: string;
}) {
  const { data: projects } = useQuery({
    queryKey: ["projects", org.id],
    queryFn: () => api<Project[]>(`/v1/orgs/${org.id}/projects`),
  });

  const visible = (projects ?? []).filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter) ||
      p.slug.toLowerCase().includes(filter) ||
      org.slug.toLowerCase().includes(filter),
  );

  // When a filter is active and nothing matches, stay out of the way. With no
  // filter, always render the header + "New" affordance so an org with zero
  // projects still has a discoverable entry point to create its first one.
  if (filter && !visible.length) return null;

  return (
    <div className="pb-1">
      <div className="flex items-center justify-between px-4 pt-1 pb-1">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Projects
        </span>
        <NewProjectDialog
          orgId={org.id}
          trigger={
            <button
              type="button"
              className="flex items-center gap-1 text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              <Plus className="size-3" aria-hidden />
              New
            </button>
          }
        />
      </div>
      {visible.length ? (
        visible.map((project) => (
          <SidebarProjectNode
            key={project.id}
            org={org}
            orgs={orgs}
            project={project}
            pathname={pathname}
          />
        ))
      ) : (
        <NewProjectDialog
          orgId={org.id}
          trigger={
            <button
              type="button"
              className="block w-full px-4 py-1.5 text-left text-xs text-muted-foreground hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              No projects yet, create one
            </button>
          }
        />
      )}
    </div>
  );
}

function SidebarProjectNode({
  org,
  orgs,
  project,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  project: Project;
  pathname: string;
}) {
  // A branch containing where you are should reveal itself, rather than leaving
  // the reader to guess which project they are inside. The project route names
  // its project, so that case resolves from the URL alone.
  //
  // A *skill* route does not say which project contains it, and the detail query
  // is deliberately lazy (`enabled: open`) — knowing would mean eagerly fetching
  // every project in every org on each page load. That trade is not worth it, so
  // a skill reached from elsewhere still needs one click to locate.
  const isActiveProject = pathname.startsWith(`/orgs/${org.id}/projects/${project.id}`);
  const [open, setOpen] = useAutoExpand(isActiveProject);

  const { data: detail } = useQuery({
    queryKey: ["project", org.id, project.id],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${org.id}/projects/${project.id}`),
    enabled: open,
  });
  const tree = detail ? buildProjectTree(detail.items) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/proj flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none">
        <ChevronRight
          className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/proj:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="truncate">{project.name}</span>
        <ProjectVisibilityIcon visibility={project.visibility} className="ml-auto" />
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {project.itemCount}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {tree ? (
          tree.nodes.length ? (
            <SidebarTreeNodes
              nodes={tree.nodes}
              itemByPath={tree.itemByPath}
              org={org}
              orgs={orgs}
              depth={1}
              pathname={pathname}
            />
          ) : (
            <p className="py-1 pr-4 pl-9 text-xs text-muted-foreground">Empty project</p>
          )
        ) : (
          <p className="py-1 pr-4 pl-9 text-xs text-muted-foreground">Loading…</p>
        )}
        <Link
          to="/orgs/$orgId/projects/$projectId"
          params={{ orgId: org.id, projectId: project.id }}
          className="block py-1 pr-4 pl-9 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Manage project →
        </Link>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarTreeNodes({
  nodes,
  itemByPath,
  org,
  orgs,
  depth,
  pathname,
}: {
  nodes: TreeNode[];
  itemByPath: Map<string, ProjectItem>;
  org: Org;
  orgs: Org[];
  depth: number;
  pathname: string;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.children ? (
          <SidebarTreeDir
            key={node.path}
            node={node}
            itemByPath={itemByPath}
            org={org}
            orgs={orgs}
            depth={depth}
            pathname={pathname}
          />
        ) : (
          <SidebarLeaf
            key={node.path}
            item={itemByPath.get(node.path)}
            org={org}
            orgs={orgs}
            depth={depth}
            pathname={pathname}
          />
        ),
      )}
    </>
  );
}

function SidebarTreeDir({
  node,
  itemByPath,
  org,
  orgs,
  depth,
  pathname,
}: {
  node: TreeNode;
  itemByPath: Map<string, ProjectItem>;
  org: Org;
  orgs: Org[];
  depth: number;
  pathname: string;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="group/dir flex w-full items-center gap-1.5 py-1 pr-4 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <ChevronRight
          className="size-3 shrink-0 transition-transform group-data-[state=open]/dir:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{node.name}/</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarTreeNodes
          nodes={node.children ?? []}
          itemByPath={itemByPath}
          org={org}
          orgs={orgs}
          depth={depth + 1}
          pathname={pathname}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarLeaf({
  item,
  org,
  orgs,
  depth,
  pathname,
}: {
  item: ProjectItem | undefined;
  org: Org;
  orgs: Org[];
  depth: number;
  pathname: string;
}) {
  if (!item) return null;
  const pad = { paddingLeft: `${depth * 12 + 20}px` } as React.CSSProperties;
  const label = projectItemLeafName(item);
  const leafClass =
    "flex items-center gap-1.5 py-1.5 pr-4 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none";

  if (item.kind === "external") {
    return (
      <a
        href={item.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={leafClass}
        style={pad}
      >
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{label}</span>
        <span className="sr-only"> (external link, opens in new tab)</span>
      </a>
    );
  }

  if (item.visibility === "public") {
    return (
      <a href={webUrl(`/${item.orgSlug}/${item.repo}`)} className={leafClass} style={pad}>
        <Folder className="size-3.5 shrink-0 text-muted-foreground opacity-0" aria-hidden />
        <span className="truncate">{label}</span>
      </a>
    );
  }

  // Internal skill: resolve the owning org's id from its slug so we can deep-link
  // into the workspace editor. Fall back to the public route if unresolved.
  const ownerOrgId = orgs.find((o) => o.slug === item.orgSlug)?.id ?? org.id;
  const href = `/orgs/${ownerOrgId}/skills/${item.repo}`;
  const active = pathname === href;
  return (
    <Link
      to="/orgs/$orgId/skills/$repo"
      params={{ orgId: ownerOrgId, repo: item.repo }}
      className={cn(
        leafClass,
        // Inset rule rather than a border: it marks the active row without
        // shifting its text, and at depth a left edge traces back to the parent
        // far better than a fill alone.
        active &&
          "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_currentColor]",
      )}
      style={pad}
    >
      <Folder className="size-3.5 shrink-0 text-muted-foreground opacity-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}
