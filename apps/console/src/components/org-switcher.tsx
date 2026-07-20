import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger, Skeleton } from "@skillist/ui";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useActiveOrg } from "@/lib/active-org";

// `/orgs/{id}/...` routes (projects, skill editor) are org-scoped via the URL;
// switching org there must move the URL too, or the switcher and page disagree.
const ORG_ROUTE = /^\/orgs\/[^/]+/;

// Show the name-filter only once the list is long enough to be worth scanning.
const FILTER_THRESHOLD = 7;

/**
 * The single global organization switcher, mounted in the app-shell top bar.
 * It lists every org the user is a member of; role gating for owner/admin pages
 * happens on those pages, not here — switching never hides an org.
 *
 * Vocabulary mirrors the agent chat-history list: the active row carries the
 * signal accent (`border-l-signal bg-muted`), inactive rows highlight on hover.
 */
export function OrgSwitcher() {
  const { orgs, activeOrg, setActiveOrgId, isPending } = useActiveOrg();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const selectOrg = useCallback(
    (id: string) => {
      setActiveOrgId(id);
      setOpen(false);
      // On an org-scoped route, follow the switch to that org's projects (the
      // current projectId/repo won't exist under the new org) so URL + switcher
      // stay coherent; elsewhere the global state change is enough.
      if (ORG_ROUTE.test(pathname)) {
        void navigate({ to: "/orgs/$orgId/projects", params: { orgId: id } });
      }
    },
    [setActiveOrgId, navigate, pathname],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => o.name.toLowerCase().includes(q));
  }, [orgs, filter]);

  // Loading → a placeholder the same rough width as the trigger.
  if (isPending) {
    return <Skeleton className="h-8 w-32" aria-label="Loading organizations" />;
  }

  // Nothing to switch to — render nothing rather than an empty control.
  if (orgs.length === 0) return null;

  // A single org isn't switchable: show it as a plain, non-interactive label.
  if (orgs.length === 1) {
    return (
      <span className="max-w-[10rem] truncate px-2 text-sm font-medium text-foreground">
        {activeOrg?.name}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFilter("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Switch organization"
          className="max-w-[12rem] gap-1.5"
        >
          <span className="truncate">{activeOrg?.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        {orgs.length > FILTER_THRESHOLD && (
          <div className="border-b border-border p-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter organizations…"
              aria-label="Filter organizations"
              className="h-8"
            />
          </div>
        )}
        <ul className="max-h-[60svh] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">No matches.</li>
          ) : (
            filtered.map((org) => {
              const isActive = org.id === activeOrg?.id;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => selectOrg(org.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 border-l-2 py-1.5 pr-2.5 pl-2.5 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      isActive ? "border-l-signal bg-muted" : "border-l-transparent hover:bg-muted",
                    )}
                  >
                    <span className="truncate text-sm text-foreground">{org.name}</span>
                    <span className="shrink-0 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
                      {org.role}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
