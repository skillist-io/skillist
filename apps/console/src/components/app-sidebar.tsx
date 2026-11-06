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
  type SkillSource,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useSession,
  useSidebar,
  webUrl,
} from "@skillist/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
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
import {
  activeSection,
  filterSummary,
  type NavSection,
  type OrgView,
  orgView,
} from "@/lib/sidebar-nav";
import { useAutoExpand } from "@/lib/use-auto-expand";

type NavItem = {
  title: string;
  to: string;
  icon: LucideIcon;
  section: NavSection;
  /** Only shown once the API has confirmed the viewer can use it. */
  adminOnly?: boolean;
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
    adminOnly: true,
  },
  {
    title: "Settings",
    to: "/settings",
    icon: Settings2,
    section: "settings",
  },
];

// Rows run edge to edge inside a scroll container, which clips anything drawn
// outside them. The ring goes inside the row so all four sides stay visible.
const rowFocus =
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring focus-visible:outline-none";

/**
 * The admin allowlist lives in a Worker env var the client can't see, so the
 * only source of truth is whether the API answers. This asks the same endpoint
 * the Mirrors page reads, under the same key, so an admin's page load is already
 * warm. It decides visibility only: the API still enforces access on every call.
 */
function useCanSeeMirrors(): boolean {
  const { isSuccess } = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: () => api<{ items: SkillSource[] }>("/v1/admin/sources"),
    // A 403 is the expected answer for most people, so don't ask twice.
    retry: false,
    refetchOnWindowFocus: false,
  });
  return isSuccess;
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = activeSection(pathname);
  const { open, isMobile, setOpenMobile } = useSidebar();
  const { data: session } = useSession();
  const canSeeMirrors = useCanSeeMirrors();
  // Held here, not in the tree, so a filter survives the panel collapsing or the
  // mobile sheet closing. Deferred so typing stays ahead of re-filtering a large
  // tree.
  const [filter, setFilter] = React.useState("");
  const deferredFilter = React.useDeferredValue(filter);
  const [privateOnly, setPrivateOnly] = React.useState(false);

  const user = {
    name: session?.user?.name ?? "User",
    email: session?.user?.email ?? "",
    avatar: session?.user?.image ?? "",
  };

  const brand = (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          asChild
          className="md:h-8 md:p-0"
          tooltip={isMobile ? undefined : { children: "Skillist — Dashboard", hidden: false }}
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
  );

  const primaryNav = (
    <nav aria-label="Primary">
      <SidebarMenu>
        {navMain
          .filter((item) => !item.adminOnly || canSeeMirrors)
          .map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                // Labels are always visible in the sheet, and a touch screen has
                // no hover to reveal a tooltip with.
                tooltip={isMobile ? undefined : { children: item.title, hidden: false }}
                asChild
                isActive={section === item.section}
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
    </nav>
  );

  /* The lock sits with the search box because they do the same job — both
     narrow this tree. It also keeps it off the panel's right edge, where it
     landed next to the sidebar collapse trigger and the two icon buttons read
     as a pair despite being unrelated.

     The lock *is* the control rather than a label beside a switch: one binary
     needs one affordance, and a switch earns its width only when the states
     need naming. aria-pressed carries the on/off the switch used to; the
     tooltip names it. On screen, on is a wash plus a filled lock: violet alone
     sits about 1:1 against the muted off state, so colour can't carry it. */
  const filterControls = (
    <div className="flex items-center gap-2">
      <SidebarInput
        className="flex-1"
        placeholder="Filter orgs and skills..."
        aria-label="Filter orgs, projects, and skills"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 aria-pressed:bg-sidebar-accent"
            aria-pressed={privateOnly}
            aria-label="Show only private skills"
            onClick={() => setPrivateOnly((v) => !v)}
          >
            <Lock
              className={cn(
                "size-4 transition-colors",
                privateOnly ? "fill-current text-signal" : "text-muted-foreground",
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {privateOnly ? "Showing private skills only" : "Show only private skills"}
        </TooltipContent>
      </Tooltip>
    </div>
  );

  const tree = (
    <nav aria-label="Orgs, projects, and skills">
      <OrgSkillNav filter={deferredFilter} privateOnly={privateOnly} pathname={pathname} />
    </nav>
  );

  if (isMobile) {
    return (
      <Sidebar collapsible="icon" {...props}>
        {/* One stacked column rather than the desktop's rail + panel: a 3rem rail
            is no use without hover tooltips, and the panel needs the width.

            Closing is keyed to the tap rather than the route, so tapping the page
            you're already on still dismisses the sheet. React events bubble
            through portals, which brings in the user menu's links too. Keyboard
            activation of a link also arrives here as a click. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated listener; the links are the interactive elements */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Enter on a link dispatches this same click */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a")) {
              setOpenMobile(false);
            }
          }}
        >
          <SidebarHeader>{brand}</SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent className="px-1.5">{primaryNav}</SidebarGroupContent>
            </SidebarGroup>
            <div className="border-t p-4">{filterControls}</div>
            {tree}
          </SidebarContent>
          <SidebarFooter>
            <NavUser user={user} />
          </SidebarFooter>
        </div>
      </Sidebar>
    );
  }

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      <Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
        <SidebarHeader>{brand}</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">{primaryNav}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={user} />
        </SidebarFooter>
      </Sidebar>

      {open ? (
        <TreePanel>
          <SidebarHeader className="gap-3.5 border-b p-4">
            <SkillistLogo />
            {filterControls}
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup className="px-0">
              <SidebarGroupContent>{tree}</SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </TreePanel>
      ) : null}
    </Sidebar>
  );
}

/**
 * The desktop panel unmounts when the sidebar collapses, which would drop focus
 * to <body> for anyone inside it (⌘B works from the filter box) and send a
 * keyboard user back to the top of the page. The element still exists during
 * this cleanup, so where focus was can still be read; the trigger is the control
 * that brings the panel back.
 */
function TreePanel({ children }: { children: React.ReactNode }) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      if (panel?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.focus();
      }
    };
  }, []);

  return (
    <Sidebar ref={panelRef} collapsible="none" className="hidden flex-1 md:flex">
      {children}
    </Sidebar>
  );
}

/** A query that failed with nothing to show, as opposed to one that came back empty. */
function hasFailed(query: { isError: boolean; data: unknown }): boolean {
  return query.isError && query.data === undefined;
}

function LoadError({
  what,
  onRetry,
  className,
}: {
  what: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-destructive", className)}>
      Couldn't load {what}.
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-6 items-center text-sidebar-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        Retry
      </button>
    </p>
  );
}

function OrgSkillNav({
  filter,
  privateOnly,
  pathname,
}: {
  filter: string;
  privateOnly: boolean;
  pathname: string;
}) {
  const needle = filter.trim().toLowerCase();

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const orgs = orgsQuery.data ?? [];

  // Fetched here rather than per org block because the empty state and the
  // result count are questions about every org at once. Same keys as before, so
  // these still dedupe with the rest of the app.
  const skillQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ["skills", org.id],
      queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
    })),
  });
  const projectQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ["projects", org.id],
      queryFn: () => api<Project[]>(`/v1/orgs/${org.id}/projects`),
    })),
  });

  // Absent data is not empty data. The cache is persisted, so `data` is the test
  // here: it can be present on first paint, and a failed refetch keeps it.
  if (!orgsQuery.data) {
    return hasFailed(orgsQuery) ? (
      <LoadError what="organizations" onRetry={() => orgsQuery.refetch()} className="p-4" />
    ) : (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading organizations…
      </p>
    );
  }

  if (!orgs.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No organizations yet. Create one on the dashboard.
      </p>
    );
  }

  const blocks = orgs.map((org, index) => {
    const skillsQuery = skillQueries[index];
    const projectsQuery = projectQueries[index];
    return {
      org,
      skillsQuery,
      projectsQuery,
      view: orgView({
        org,
        skills: skillsQuery?.data,
        projects: projectsQuery?.data,
        needle,
        privateOnly,
      }),
    };
  });

  // An org that couldn't load stays listed so its error shows. Leaving it out
  // would let "no matches" stand for "we couldn't check".
  const shown = blocks.filter(
    ({ view, skillsQuery, projectsQuery }) =>
      view.visible ||
      (skillsQuery && hasFailed(skillsQuery)) ||
      (projectsQuery && hasFailed(projectsQuery)),
  );
  const stillLoading = blocks.some(
    ({ skillsQuery, projectsQuery }) => skillsQuery?.isPending || projectsQuery?.isPending,
  );
  const anyFailed = blocks.some(
    ({ skillsQuery, projectsQuery }) =>
      (skillsQuery && hasFailed(skillsQuery)) || (projectsQuery && hasFailed(projectsQuery)),
  );
  const narrowed = Boolean(needle) || privateOnly;

  // A count taken over partial data would claim more than we know, the same way
  // "no matches" would on screen.
  let announcement = "";
  if (narrowed && !stillLoading) {
    announcement = anyFailed
      ? "Some results couldn't be loaded"
      : filterSummary(
          shown.reduce((total, block) => total + block.view.skills.length, 0),
          shown.reduce((total, block) => total + block.view.projects.length, 0),
        );
  }

  return (
    <>
      {/* Stays mounted across filter changes: a live region only announces
          updates to a node that was already in the tree. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {shown.length ? (
        shown.map(({ org, view, skillsQuery, projectsQuery }) =>
          skillsQuery && projectsQuery ? (
            <OrgBlock
              key={org.id}
              org={org}
              orgs={orgs}
              view={view}
              skillsQuery={skillsQuery}
              projectsQuery={projectsQuery}
              narrowed={narrowed}
              privateOnly={privateOnly}
              pathname={pathname}
            />
          ) : null,
        )
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          {stillLoading
            ? "Loading skills…"
            : privateOnly
              ? "No private skills match your filters."
              : "No skills match your filters."}
        </p>
      )}
    </>
  );
}

type SectionQuery = {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  refetch: () => unknown;
};

function OrgBlock({
  org,
  orgs,
  view,
  skillsQuery,
  projectsQuery,
  narrowed,
  privateOnly,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  view: OrgView;
  skillsQuery: SectionQuery;
  projectsQuery: SectionQuery;
  narrowed: boolean;
  privateOnly: boolean;
  pathname: string;
}) {
  const skillsFailed = hasFailed(skillsQuery);
  // While narrowing, a section with no results says nothing rather than "No
  // skills yet", which would be a claim about the org rather than the filter.
  const showSkills = !narrowed || view.skills.length > 0 || skillsFailed || skillsQuery.isPending;

  return (
    <div className="border-b last:border-b-0">
      <div className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {org.name}
      </div>
      {/* Projects axis: curated trees. Private-only is a skills-focused view, so
          curation is hidden while it's engaged. */}
      {!privateOnly && (
        <OrgProjectsSection
          org={org}
          orgs={orgs}
          projects={view.projects}
          query={projectsQuery}
          narrowed={narrowed}
          pathname={pathname}
        />
      )}
      {showSkills && (
        <div className="pb-1">
          <div className="px-4 pt-1 pb-1 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
            Skills
          </div>
          {view.skills.length ? (
            view.skills.map((skill) => {
              const href = `/orgs/${org.id}/skills/${skill.repo}`;
              const active = pathname === href;
              return (
                <Link
                  key={skill.id}
                  to="/orgs/$orgId/skills/$repo"
                  params={{ orgId: org.id, repo: skill.repo }}
                  className={cn(
                    "flex flex-col items-start gap-1 px-4 py-3 text-sm leading-tight hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    rowFocus,
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_currentColor]",
                  )}
                >
                  <span className="font-medium">{skill.repo}</span>
                  <span className="text-xs text-muted-foreground">{skill.visibility}</span>
                </Link>
              );
            })
          ) : skillsFailed ? (
            <LoadError what="skills" onRetry={skillsQuery.refetch} className="px-4 pb-2" />
          ) : (
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              {skillsQuery.isPending ? "Loading skills…" : "No skills yet"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OrgProjectsSection({
  org,
  orgs,
  projects,
  query,
  narrowed,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  projects: Project[];
  query: SectionQuery;
  narrowed: boolean;
  pathname: string;
}) {
  const failed = hasFailed(query);

  // When narrowing and nothing matches, stay out of the way. Otherwise always
  // render the header + "New" affordance so an org with zero projects still has
  // a discoverable entry point to create its first one.
  if (narrowed && !projects.length && !failed && !query.isPending) return null;

  return (
    <div className="pb-1">
      <div className="flex items-center justify-between px-4 pt-1 pb-1">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Projects
        </span>
        <NewProjectDialog
          orgId={org.id}
          trigger={
            // 24px target (WCAG 2.5.8) around a 10px label. The negative margins
            // hand the extra height back so the header row keeps its rhythm.
            <button
              type="button"
              className="-my-1 -mr-1 flex h-6 items-center gap-1 px-1 text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              <Plus className="size-3" aria-hidden />
              New
            </button>
          }
        />
      </div>
      {projects.length ? (
        projects.map((project) => (
          <SidebarProjectNode
            key={project.id}
            org={org}
            orgs={orgs}
            project={project}
            pathname={pathname}
          />
        ))
      ) : failed ? (
        <LoadError what="projects" onRetry={query.refetch} className="px-4 pb-2" />
      ) : query.isPending ? (
        <p className="px-4 py-1.5 text-xs text-muted-foreground">Loading projects…</p>
      ) : (
        <NewProjectDialog
          orgId={org.id}
          trigger={
            <button
              type="button"
              className={cn(
                "block w-full px-4 py-1.5 text-left text-xs text-muted-foreground hover:text-sidebar-accent-foreground",
                rowFocus,
              )}
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

  const detailQuery = useQuery({
    queryKey: ["project", org.id, project.id],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${org.id}/projects/${project.id}`),
    enabled: open,
  });
  const detail = detailQuery.data;
  const tree = React.useMemo(() => (detail ? buildProjectTree(detail.items) : null), [detail]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "group/proj flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          rowFocus,
        )}
      >
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
        ) : hasFailed(detailQuery) ? (
          <LoadError what="project" onRetry={detailQuery.refetch} className="py-1 pr-4 pl-9" />
        ) : (
          <p className="py-1 pr-4 pl-9 text-xs text-muted-foreground">Loading…</p>
        )}
        <Link
          to="/orgs/$orgId/projects/$projectId"
          params={{ orgId: org.id, projectId: project.id }}
          className={cn(
            "block py-1 pr-4 pl-9 text-xs text-muted-foreground hover:text-foreground hover:underline",
            rowFocus,
          )}
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
        className={cn(
          "group/dir flex w-full items-center gap-1.5 py-1 pr-4 text-left text-xs text-muted-foreground hover:text-foreground",
          rowFocus,
        )}
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
  const leafClass = cn(
    "flex items-center gap-1.5 py-1.5 pr-4 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    rowFocus,
  );

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
