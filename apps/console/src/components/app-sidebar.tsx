import type { TreeNode } from "@skillist/ui";
import {
  api,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  type FailurePattern,
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
  useSkillRealtime,
  webUrl,
} from "@skillist/ui";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  PackageSearch,
  Plus,
  Settings2,
  Shield,
  Target,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import * as React from "react";
import { NavUser } from "@/components/nav-user";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectVisibilityIcon } from "@/components/project-visibility";
import { useActiveOrg } from "@/lib/active-org";
import { buildProjectTree, projectItemLeafName } from "@/lib/project-tree";
import {
  activeSection,
  filterSummary,
  type NavSection,
  type OrgView,
  orgView,
  pinActiveOrg,
  type SkillStatus,
  skillStatus,
} from "@/lib/sidebar-nav";
import { useAutoExpand } from "@/lib/use-auto-expand";
import { useRovingFocus } from "@/lib/use-roving-focus";

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
  const { open, setOpen, isMobile, setOpenMobile } = useSidebar();
  const { data: session } = useSession();
  const canSeeMirrors = useCanSeeMirrors();
  // Held here, not in the tree, so a filter survives the panel collapsing or the
  // mobile sheet closing. Deferred so typing stays ahead of re-filtering a large
  // tree.
  const [filter, setFilter] = React.useState("");
  const deferredFilter = React.useDeferredValue(filter);
  const [privateOnly, setPrivateOnly] = React.useState(false);

  // `/` jumps to the filter from anywhere that isn't already taking text. The
  // panel may be collapsed, in which case the input doesn't exist until it opens.
  const filterRef = React.useRef<HTMLInputElement>(null);
  const focusAfterOpen = React.useRef(false);
  React.useEffect(() => {
    if (isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) {
        return;
      }
      event.preventDefault();
      if (filterRef.current) filterRef.current.focus();
      else {
        focusAfterOpen.current = true;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, setOpen]);
  React.useEffect(() => {
    if (open && focusAfterOpen.current) {
      focusAfterOpen.current = false;
      filterRef.current?.focus();
    }
  }, [open]);

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
                // The same 32px square the primitive forces when collapsed. At its
                // default 36px height, every toggle slid the icons up the rail,
                // by more the further down they sat. Mobile keeps full-width rows.
                // Icons go muted to ink because the rail has no labels, and the
                // active wash alone is about 1.09:1 in light mode.
                className="px-2.5 data-[active=true]:[&>svg]:text-sidebar-accent-foreground md:size-8 md:px-2 [&>svg]:text-muted-foreground hover:[&>svg]:text-sidebar-accent-foreground"
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
      <div className="relative min-w-0 flex-1">
        <SidebarInput
          ref={filterRef}
          className={filter ? "pr-7" : undefined}
          placeholder="Filter orgs and skills..."
          aria-label="Filter orgs, projects, and skills"
          aria-keyshortcuts="/"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && filter) {
              // Clears here rather than also closing the mobile sheet around it.
              e.stopPropagation();
              setFilter("");
            }
          }}
        />
        {filter && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => {
              setFilter("");
              filterRef.current?.focus();
            }}
            className="absolute top-1 right-0 flex size-6 items-center justify-center text-muted-foreground hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
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
    <TreeNav>
      <OrgSkillNav filter={deferredFilter} privateOnly={privateOnly} pathname={pathname} />
    </TreeNav>
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
      // clip, not hidden: `hidden` is still a scroll container, so focus moving to
      // something near the edge could scroll the rail out of view.
      className="overflow-clip *:data-[sidebar=sidebar]:flex-row"
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
    // min-w-0: this is a flex child, and without it a nowrap project name widens
    // the panel past its slot, pushing the lock and counts out of view.
    <Sidebar ref={panelRef} collapsible="none" className="hidden min-w-0 flex-1 md:flex">
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

/** Keeps the tree to a single Tab stop; see useRovingFocus. */
function TreeNav({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLElement>(null);
  useRovingFocus(ref);
  return (
    <nav ref={ref} aria-label="Orgs, projects, and skills">
      {children}
    </nav>
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
  const narrowed = Boolean(needle) || privateOnly;
  const { activeOrgId } = useActiveOrg();

  const orgsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  // The rail and every page act on the active org, so it leads the tree. Without
  // this the tree showed the same list in the same order whatever the switcher
  // said, and the two read as unrelated scopes.
  const orgs = React.useMemo(
    () => pinActiveOrg(orgsQuery.data ?? [], activeOrgId),
    [orgsQuery.data, activeOrgId],
  );

  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(activeOrgId ? [activeOrgId] : []),
  );
  // Opens the org you move to and leaves the rest as you set them, the same
  // asymmetry as useAutoExpand: arriving reveals, leaving never folds things up.
  React.useEffect(() => {
    if (!activeOrgId) return;
    setExpanded((open) => (open.has(activeOrgId) ? open : new Set(open).add(activeOrgId)));
  }, [activeOrgId]);

  const toggleOrg = (id: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Fetched here rather than per org block because the empty state and the
  // result count are questions about every org at once. Same keys as the rest
  // of the app, so these dedupe. A collapsed org costs nothing until it's opened
  // or a filter has to look inside it.
  const isOpen = (org: Org) => narrowed || expanded.has(org.id);
  const skillQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ["skills", org.id],
      queryFn: () => api<Skill[]>(`/v1/orgs/${org.id}/skills`),
      enabled: isOpen(org),
    })),
  });
  const projectQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ["projects", org.id],
      queryFn: () => api<Project[]>(`/v1/orgs/${org.id}/projects`),
      enabled: isOpen(org),
    })),
  });
  // Shared with the dashboard. Refused for some roles, which only means rows
  // can't say "failing"; skillStatus never claims the opposite.
  const failureQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ["failure-patterns", org.id, "open"],
      queryFn: () =>
        api<{ patterns: FailurePattern[] }>(`/v1/orgs/${org.id}/failure-patterns?status=open`),
      retry: false,
      enabled: isOpen(org),
    })),
  });

  // Project contents load lazily, so searching them means fetching them. That
  // only happens while filtering, once per project, and it stays cached.
  const allProjects = orgs.flatMap((org, index) =>
    (projectQueries[index]?.data ?? []).map((project) => ({ org, project })),
  );
  const detailQueries = useQueries({
    queries: allProjects.map(({ org, project }) => ({
      queryKey: ["project", org.id, project.id],
      queryFn: () => api<ProjectDetail>(`/v1/orgs/${org.id}/projects/${project.id}`),
      enabled: Boolean(needle),
    })),
  });
  const projectItems = new Map<string, ProjectItem[]>();
  detailQueries.forEach((query, index) => {
    const project = allProjects[index]?.project;
    if (project && query.data?.items) projectItems.set(project.id, query.data.items);
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
        No organizations yet.{" "}
        <Link to="/dashboard" className="underline underline-offset-2">
          Create one on the dashboard.
        </Link>
      </p>
    );
  }

  const blocks = orgs.map((org, index) => {
    const skillsQuery = skillQueries[index];
    const projectsQuery = projectQueries[index];
    const failures = new Map<string, number>();
    for (const pattern of failureQueries[index]?.data?.patterns ?? []) {
      failures.set(pattern.skillRepo, (failures.get(pattern.skillRepo) ?? 0) + 1);
    }
    return {
      org,
      skillsQuery,
      projectsQuery,
      failures,
      view: orgView({
        org,
        skills: skillsQuery?.data,
        projects: projectsQuery?.data,
        projectItems,
        needle,
        privateOnly,
      }),
    };
  });

  const failed = ({ skillsQuery, projectsQuery }: (typeof blocks)[number]) =>
    (skillsQuery && hasFailed(skillsQuery)) || (projectsQuery && hasFailed(projectsQuery));

  // Unfiltered, every org stays listed so it can be opened. Narrowed, an org
  // that couldn't load stays listed so its error shows: leaving it out would let
  // "no matches" stand for "we couldn't check".
  const shown = narrowed ? blocks.filter((block) => block.view.visible || failed(block)) : blocks;
  const stillLoading =
    narrowed &&
    (blocks.some((b) => b.skillsQuery?.isPending || b.projectsQuery?.isPending) ||
      (Boolean(needle) && detailQueries.some((query) => query.isPending)));

  // A count taken over partial data would claim more than we know, the same way
  // "no matches" would on screen.
  let announcement = "";
  if (narrowed && !stillLoading) {
    announcement = blocks.some(failed)
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
        shown.map(({ org, view, failures, skillsQuery, projectsQuery }) =>
          skillsQuery && projectsQuery ? (
            <OrgBlock
              key={org.id}
              org={org}
              orgs={orgs}
              view={view}
              failures={failures}
              skillsQuery={skillsQuery}
              projectsQuery={projectsQuery}
              open={isOpen(org)}
              onToggle={narrowed ? undefined : () => toggleOrg(org.id)}
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

const sectionLabel = "text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase";

function OrgBlock({
  org,
  orgs,
  view,
  failures,
  skillsQuery,
  projectsQuery,
  open,
  onToggle,
  narrowed,
  privateOnly,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  view: OrgView;
  failures: Map<string, number>;
  skillsQuery: SectionQuery;
  projectsQuery: SectionQuery;
  open: boolean;
  /** Absent while filtering: results decide what's open then, not the reader. */
  onToggle?: () => void;
  narrowed: boolean;
  privateOnly: boolean;
  pathname: string;
}) {
  const skillsFailed = hasFailed(skillsQuery);
  // While narrowing, a section with no results says nothing rather than "No
  // skills yet", which would be a claim about the org rather than the filter.
  const showSkills = !narrowed || view.skills.length > 0 || skillsFailed || skillsQuery.isPending;

  return (
    <section className="border-b last:border-b-0">
      {/* The org is the top of this hierarchy, so it speaks at reading size in
          ink. It's a human name, not an equipment label, and keeps its case. */}
      <h2>
        <button
          type="button"
          aria-expanded={open}
          disabled={!onToggle}
          onClick={onToggle}
          className={cn(
            "group/org flex min-h-10 w-full items-start gap-1.5 px-4 py-2 text-left text-sm font-medium",
            onToggle && "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            rowFocus,
          )}
        >
          <ChevronRight
            className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-aria-expanded/org:rotate-90 motion-reduce:transition-none"
            aria-hidden
          />
          <span className="min-w-0 wrap-anywhere">{org.name}</span>
        </button>
      </h2>
      {open && (
        <div className="pb-2">
          {/* Projects axis: curated trees. Private-only is a skills-focused view,
              so curation is hidden while it's engaged. */}
          {!privateOnly && (
            <OrgProjectsSection
              org={org}
              orgs={orgs}
              projects={view.projects}
              matchedInside={view.matchedInside}
              query={projectsQuery}
              narrowed={narrowed}
              pathname={pathname}
            />
          )}
          {showSkills && (
            <div className="pb-1">
              <h3 className={cn("px-4 pt-1 pb-1", sectionLabel)}>Skills</h3>
              {view.skills.length ? (
                view.skills.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    org={org}
                    skill={skill}
                    openFailures={failures.get(skill.repo)}
                    active={pathname === `/orgs/${org.id}/skills/${skill.repo}`}
                  />
                ))
              ) : skillsFailed ? (
                <LoadError what="skills" onRetry={skillsQuery.refetch} className="px-4 pb-2" />
              ) : skillsQuery.isPending ? (
                <p className="px-4 pb-3 text-xs text-muted-foreground">Loading skills…</p>
              ) : (
                <Link
                  to="/dashboard"
                  className={cn(
                    "block px-4 py-1.5 text-xs text-muted-foreground hover:text-sidebar-accent-foreground",
                    rowFocus,
                  )}
                >
                  No skills yet, add one
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const VISIBILITY_ICON: Record<string, LucideIcon | undefined> = {
  org: Users,
  public: Globe,
};

/**
 * One line, answering what a row is for: which skill, and what state it's in.
 * Private is the default, so only a wider audience earns an icon; the word stays
 * for screen readers either way.
 */
function SkillRow({
  org,
  skill,
  openFailures,
  active,
}: {
  org: Org;
  skill: Skill;
  openFailures?: number;
  active: boolean;
}) {
  const ref = React.useRef<HTMLAnchorElement>(null);
  // A deep link can land thousands of pixels down a long tree. Without this the
  // row that says where you are is the one row you can't see.
  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const status = skillStatus(skill, openFailures);
  const VisibilityIcon = VISIBILITY_ICON[skill.visibility];

  return (
    <Link
      ref={ref}
      to="/orgs/$orgId/skills/$repo"
      params={{ orgId: org.id, repo: skill.repo }}
      title={skill.repo}
      className={cn(
        "flex h-8 items-center gap-2 px-4 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        rowFocus,
        active &&
          "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_currentColor]",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{skill.repo}</span>
      {active && <LiveMarker org={org} repo={skill.repo} />}
      {VisibilityIcon && (
        <VisibilityIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="sr-only">{skill.visibility}</span>
      <SkillStatusReadout status={status} />
    </Link>
  );
}

/** Word first, shape second, colour last, so state never rests on colour alone. */
function SkillStatusReadout({ status }: { status: SkillStatus }) {
  if (status.kind === "unknown") return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 font-mono text-xs",
        status.kind === "failing" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {status.kind === "failing" && <TriangleAlert className="size-3" aria-hidden />}
      {status.kind === "draft" && <CircleDashed className="size-3" aria-hidden />}
      {status.label}
    </span>
  );
}

/**
 * Live state for the open skill only. The realtime hub is one channel per skill,
 * so watching the whole tree would mean a socket per row; an honest marker on
 * every row needs an org-level channel first. A publish refreshes the list so
 * the version beside this marker stays true.
 */
function LiveMarker({ org, repo }: { org: Org; repo: string }) {
  const { connected, lastEvent } = useSkillRealtime(org.slug, repo);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (lastEvent) void queryClient.invalidateQueries({ queryKey: ["skills", org.id] });
  }, [lastEvent, org.id, queryClient]);

  if (!connected) return null;
  return (
    <>
      <span aria-hidden title="Live" className="size-1.5 shrink-0 bg-signal" />
      <span className="sr-only">Live</span>
    </>
  );
}

function OrgProjectsSection({
  org,
  orgs,
  projects,
  matchedInside,
  query,
  narrowed,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  projects: Project[];
  matchedInside: Set<string>;
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
        <h3 className={sectionLabel}>Projects</h3>
        <NewProjectDialog
          orgId={org.id}
          trigger={
            // 24px target (WCAG 2.5.8). The negative margins hand the extra height
            // back so the header row keeps its rhythm. Every org has one of these,
            // so the name says which org it creates in.
            <button
              type="button"
              aria-label={`New project in ${org.name}`}
              className={cn(
                "-my-1 -mr-1 flex h-6 items-center gap-1 px-1 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                sectionLabel,
              )}
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
            forceOpen={matchedInside.has(project.id)}
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
  forceOpen,
  pathname,
}: {
  org: Org;
  orgs: Org[];
  project: Project;
  /** Something inside matched the filter. Doesn't touch the reader's own state. */
  forceOpen: boolean;
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
  const [userOpen, setOpen] = useAutoExpand(isActiveProject);
  const open = userOpen || forceOpen;

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
          isActiveProject && "bg-sidebar-accent text-sidebar-accent-foreground",
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
            "block py-1 pr-4 pl-9 text-xs hover:text-foreground hover:underline",
            isActiveProject ? "font-medium text-foreground" : "text-muted-foreground",
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
        <span className="truncate font-mono">{node.name}/</span>
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
}: {
  item: ProjectItem | undefined;
  org: Org;
  orgs: Org[];
  depth: number;
}) {
  const navigate = useNavigate();
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

  // Resolve the owning org so the row opens the console's editor, the same
  // destination as the Skills list. Only a public skill from an org you aren't in
  // leaves for the registry, and it says so.
  const ownerOrg = orgs.find((o) => o.slug === item.orgSlug);
  if (!ownerOrg && item.visibility === "public") {
    return (
      <a href={webUrl(`/${item.orgSlug}/${item.repo}`)} className={leafClass} style={pad}>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn("truncate", !item.label && "font-mono text-xs")}>{label}</span>
        <span className="sr-only"> (opens the public registry)</span>
      </a>
    );
  }

  const orgId = ownerOrg?.id ?? org.id;
  // A plain anchor, not <Link>: the router marks every link to the current page
  // aria-current, and the Skills list row already claims that for this skill.
  // Two "current" rows tell a screen reader the page is in two places.
  return (
    <a
      href={`/orgs/${orgId}/skills/${item.repo}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({
          to: "/orgs/$orgId/skills/$repo",
          params: { orgId, repo: item.repo },
        });
      }}
      className={leafClass}
      style={pad}
    >
      <Folder className="size-3.5 shrink-0 text-muted-foreground opacity-0" aria-hidden />
      <span className={cn("truncate", !item.label && "font-mono text-xs")}>{label}</span>
    </a>
  );
}
