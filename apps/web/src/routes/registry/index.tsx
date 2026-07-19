import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, Check, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddToProjectButton } from "@/components/add-to-project";
import { CopyButton } from "@/components/copy-button";
import { QueryError } from "@/components/query-error";
import { ScoreReadout } from "@/components/score-readout";
import { StarStat } from "@/components/star-stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageTitle } from "@/components/ui/page-title";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, type RegistryItem } from "@/lib/api";
import { cn, formatCount } from "@/lib/utils";

type Sort =
  | "quality"
  | "impact"
  | "installs"
  | "activations"
  | "stars"
  | "trending"
  | "recent"
  | "name";
type Runtime = "all" | "local" | "sandbox" | "container";
type Security = "all" | "pass" | "advisory" | "fail";
type SourceType = "all" | "native" | "mirror";

type RegistryFilters = {
  q: string;
  sort: Sort;
  runtime: Runtime;
  minQuality: string;
  security: Security;
  category: string;
  tag: string;
  agent: string;
  sourceType: SourceType;
};

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "quality", label: "Quality" },
  { value: "impact", label: "Impact" },
  { value: "installs", label: "Installs" },
  { value: "activations", label: "Activations" },
  { value: "stars", label: "Stars" },
  { value: "trending", label: "Trending" },
  { value: "recent", label: "Recently updated" },
  { value: "name", label: "Name" },
];

const RUNTIME_OPTIONS: { value: Runtime; label: string }[] = [
  { value: "all", label: "All" },
  { value: "local", label: "Local" },
  { value: "sandbox", label: "Sandbox" },
  { value: "container", label: "Container" },
];

const SECURITY_OPTIONS: { value: Security; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pass", label: "Pass" },
  { value: "advisory", label: "Advisory" },
  { value: "fail", label: "Fail" },
];

const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "native", label: "Native" },
  { value: "mirror", label: "Mirror" },
];

const QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "60", label: "60+" },
  { value: "80", label: "80+" },
  { value: "90", label: "90+" },
];

function buildRegistryQuery(filters: RegistryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  params.set("sort", filters.sort);
  params.set("runtime", filters.runtime);
  if (filters.minQuality) params.set("minQuality", filters.minQuality);
  params.set("security", filters.security);
  if (filters.category) params.set("category", filters.category);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.sourceType !== "all") params.set("sourceType", filters.sourceType);
  return params.toString();
}

export const Route = createFileRoute("/registry/")({
  component: RegistryPage,
});

const INITIAL: RegistryFilters = {
  q: "",
  sort: "quality",
  runtime: "all",
  minQuality: "",
  security: "all",
  category: "",
  tag: "",
  agent: "",
  sourceType: "all",
};

function RegistryPage() {
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<Sort>(INITIAL.sort);
  const [runtime, setRuntime] = useState<Runtime>(INITIAL.runtime);
  const [minQuality, setMinQuality] = useState(INITIAL.minQuality);
  const [security, setSecurity] = useState<Security>(INITIAL.security);
  const [category, setCategory] = useState(INITIAL.category);
  const [tag, setTag] = useState(INITIAL.tag);
  const [agent, setAgent] = useState(INITIAL.agent);
  const [sourceType, setSourceType] = useState<SourceType>(INITIAL.sourceType);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queryString = buildRegistryQuery({
    q: debouncedQ,
    sort,
    runtime,
    minQuality,
    security,
    category,
    tag,
    agent,
    sourceType,
  });

  const { data: facets } = useQuery({
    queryKey: ["registry-facets"],
    queryFn: () =>
      api<{ categories: string[]; tags: string[]; agents: string[]; sourceTypes?: string[] }>(
        "/v1/registry/facets",
      ),
  });

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["registry", queryString],
    queryFn: () => api<{ items: RegistryItem[]; total: number }>(`/v1/registry?${queryString}`),
  });

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (runtime !== "all") n++;
    if (security !== "all") n++;
    if (minQuality) n++;
    if (category) n++;
    if (tag) n++;
    if (agent) n++;
    if (sourceType !== "all") n++;
    if (debouncedQ) n++;
    return n;
  }, [runtime, security, minQuality, category, tag, agent, sourceType, debouncedQ]);

  function clearFilters() {
    setSearch("");
    setDebouncedQ("");
    setRuntime(INITIAL.runtime);
    setMinQuality(INITIAL.minQuality);
    setSecurity(INITIAL.security);
    setCategory(INITIAL.category);
    setTag(INITIAL.tag);
    setAgent(INITIAL.agent);
    setSourceType(INITIAL.sourceType);
  }

  const railProps = {
    runtime,
    setRuntime,
    security,
    setSecurity,
    minQuality,
    setMinQuality,
    category,
    setCategory,
    tag,
    setTag,
    agent,
    setAgent,
    sourceType,
    setSourceType,
    facets,
    activeFilterCount,
    onClear: clearFilters,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <PageTitle>Public Registry</PageTitle>
            <p className="max-w-prose text-sm text-muted-foreground">
              Browse Agent Skills scored for quality, impact, and security. Copy an install command
              or open a skill for the full bundle.
            </p>
          </div>
          <p className="font-mono text-sm text-muted-foreground" aria-live="polite">
            {data ? `${data.total} skill${data.total === 1 ? "" : "s"}` : " "}
          </p>
        </header>

        {/* Toolbar: search + sort always visible; Filters opens a sheet below lg */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Search skills"
              placeholder="Search by name, description, or repo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-6 pointer-coarse:h-11"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="registry-sort" className="text-muted-foreground">
              Sort
            </Label>
            <NativeSelect
              id="registry-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" className="pointer-coarse:min-h-11 lg:hidden">
                <SlidersHorizontal aria-hidden />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[88%] gap-0 p-0 sm:max-w-sm">
              <SheetTitle className="sr-only">Filters</SheetTitle>
              <SheetDescription className="sr-only">
                Narrow the registry by runtime, quality, security, category, tags, and agents.
              </SheetDescription>
              <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-14">
                <FilterRail {...railProps} showHeader={false} />
              </div>
              <SheetFooter className="flex-row gap-2 border-t border-border p-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 pointer-coarse:min-h-11"
                  onClick={clearFilters}
                  disabled={activeFilterCount === 0}
                >
                  Clear
                </Button>
                <SheetClose asChild>
                  <Button type="button" className="flex-1 pointer-coarse:min-h-11">
                    {data
                      ? `Show ${data.total} result${data.total === 1 ? "" : "s"}`
                      : "Show results"}
                  </Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
          {/* Filter rail: persistent column on desktop only; the sheet covers below lg */}
          <aside className="hidden lg:block">
            <FilterRail {...railProps} />
          </aside>

          {/* Results */}
          <section aria-busy={isFetching} className="min-w-0">
            {isError ? (
              <QueryError title="Could not load registry" onRetry={() => void refetch()} />
            ) : isLoading ? (
              <ResultsSkeleton />
            ) : data && data.items.length > 0 ? (
              <Results items={data.items} sort={sort} setSort={setSort} />
            ) : (
              <EmptyState hasFilters={activeFilterCount > 0} onClear={clearFilters} />
            )}
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Results: ledger table on desktop, card grid on phone (1 col) and tablet (2) */
/* -------------------------------------------------------------------------- */

function Results({
  items,
  sort,
  setSort,
}: {
  items: RegistryItem[];
  sort: Sort;
  setSort: (s: Sort) => void;
}) {
  return (
    <>
      {/* Desktop: ledger table */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <SortHeader
                label="Skill"
                sortKey="name"
                active={sort}
                onSort={setSort}
                align="left"
              />
              <th className="px-3 py-2.5 text-left align-bottom">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Scores
                </span>
              </th>
              <SortHeader
                label="Installs"
                sortKey="installs"
                active={sort}
                onSort={setSort}
                align="right"
              />
              <SortHeader
                label="Stars"
                sortKey="stars"
                active={sort}
                onSort={setSort}
                align="right"
              />
              <th className="px-3 py-2.5 text-right align-bottom">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Install
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <RegistryRow key={`${item.orgSlug}/${item.skillRepo}`} item={item} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: single column · tablet: two columns · desktop uses the table above */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:hidden">
        {items.map((item) => (
          <li key={`${item.orgSlug}/${item.skillRepo}`} className="flex">
            <RegistryCard item={item} />
          </li>
        ))}
      </ul>
    </>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  onSort,
  align,
}: {
  label: string;
  sortKey: Sort;
  active: Sort;
  onSort: (s: Sort) => void;
  align: "left" | "right";
}) {
  const isActive = active === sortKey;
  return (
    <th
      className={cn("px-3 py-2.5 align-bottom", align === "right" ? "text-right" : "text-left")}
      aria-sort={isActive ? (sortKey === "name" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded-none text-xs font-semibold tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          align === "right" && "flex-row-reverse",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <ArrowDown
          className={cn(
            "size-3 transition-opacity",
            isActive ? "opacity-100" : "opacity-0",
            sortKey === "name" && "rotate-180",
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}

function RegistryRow({ item }: { item: RegistryItem }) {
  const installCmd = item.installCommand ?? `skillist install ${item.orgSlug}/${item.skillRepo}`;
  return (
    <tr className="border-b border-border align-top transition-colors hover:bg-muted/40">
      <td className="w-full px-3 py-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Link
              to="/$org/$repo"
              params={{ org: item.orgSlug, repo: item.skillRepo }}
              className="rounded-none font-semibold outline-none transition-colors hover:text-signal focus-visible:text-signal focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {item.name}
            </Link>
            {item.latestVersion && (
              <span className="font-mono text-xs text-muted-foreground">v{item.latestVersion}</span>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {item.orgSlug}/{item.skillRepo}
          </span>
          {item.description && (
            <p className="line-clamp-2 max-w-prose text-sm text-muted-foreground text-pretty">
              {item.description}
            </p>
          )}
          <MetaTags item={item} />
        </div>
      </td>
      <td className="px-3 py-4">
        <ScoreReadout
          quality={item.qualityScore}
          impact={item.impactScore}
          security={item.securityStatus}
        />
      </td>
      <td className="px-3 py-4 text-right font-mono tabular-nums">
        {formatCount(item.installCount)}
      </td>
      <td className="px-3 py-4 text-right font-mono tabular-nums">
        <StarStat
          org={item.orgSlug}
          repo={item.skillRepo}
          stars={item.stars}
          starred={item.starred}
        />
      </td>
      <td className="px-3 py-4">
        <div className="flex items-center justify-end gap-2">
          <AddToProjectButton
            target={
              item.skillId
                ? { kind: "skill", skillId: item.skillId, label: item.name }
                : {
                    kind: "external",
                    externalUrl: `https://skillist.io/${item.orgSlug}/${item.skillRepo}`,
                    externalName: item.name,
                  }
            }
            variant="ghost"
            iconOnly
          />
          <CopyButton value={installCmd} label="Install" size="sm" />
          <Button asChild variant="ghost" size="sm">
            <Link
              to="/$org/$repo"
              params={{ org: item.orgSlug, repo: item.skillRepo }}
              aria-label={`View ${item.name}`}
            >
              View
            </Link>
          </Button>
        </div>
      </td>
    </tr>
  );
}

function RegistryCard({ item }: { item: RegistryItem }) {
  const installCmd = item.installCommand ?? `skillist install ${item.orgSlug}/${item.skillRepo}`;
  return (
    <Card
      data-size="sm"
      className="group w-full transition-[background-color,box-shadow] duration-200 hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_3%)] hover:ring-foreground/15"
    >
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Link
              to="/$org/$repo"
              params={{ org: item.orgSlug, repo: item.skillRepo }}
              className="rounded-none font-semibold outline-none transition-colors hover:text-signal focus-visible:text-signal focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {item.name}
            </Link>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {item.orgSlug}/{item.skillRepo}
              {item.latestVersion ? ` · v${item.latestVersion}` : ""}
            </p>
          </div>
          <div className="shrink-0">
            <StarStat
              org={item.orgSlug}
              repo={item.skillRepo}
              stars={item.stars}
              starred={item.starred}
              withIcon
            />
          </div>
        </div>
        {item.description && (
          <p className="line-clamp-3 text-sm text-muted-foreground text-pretty">
            {item.description}
          </p>
        )}
        <ScoreReadout
          quality={item.qualityScore}
          impact={item.impactScore}
          security={item.securityStatus}
        />
        <MetaTags item={item} />
        <div className="mt-auto space-y-2 pt-1">
          <span className="block font-mono text-xs text-muted-foreground tabular-nums">
            {formatCount(item.installCount)} installs · {formatCount(item.activationCount)}{" "}
            activations
          </span>
          <div className="flex items-center gap-2">
            <CopyButton
              value={installCmd}
              label="Install"
              size="default"
              className="flex-1 pointer-coarse:min-h-11"
            />
            <AddToProjectButton
              target={
                item.skillId
                  ? { kind: "skill", skillId: item.skillId, label: item.name }
                  : {
                      kind: "external",
                      externalUrl: `https://skillist.io/${item.orgSlug}/${item.skillRepo}`,
                      externalName: item.name,
                    }
              }
              variant="ghost"
              iconOnly
            />
            <Button asChild variant="ghost" size="default" className="pointer-coarse:min-h-11">
              <Link
                to="/$org/$repo"
                params={{ org: item.orgSlug, repo: item.skillRepo }}
                aria-label={`View ${item.name}`}
              >
                View
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetaTags({ item }: { item: RegistryItem }) {
  const tags = item.tags ?? [];
  const agents = item.compatibleAgents ?? [];
  const shownTags = tags.slice(0, 3);
  const extraTags = tags.length - shownTags.length;
  const isMirror = item.sourceType === "mirror";
  if (
    !isMirror &&
    (!item.runtime || item.runtime === "local") &&
    shownTags.length === 0 &&
    agents.length === 0
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
      {isMirror && <Badge variant="outline">Mirror</Badge>}
      {item.runtime && item.runtime !== "local" && (
        <Badge variant="secondary">{item.runtime}</Badge>
      )}
      {shownTags.map((t) => (
        <Badge key={t} variant="outline">
          {t}
        </Badge>
      ))}
      {extraTags > 0 && <span className="text-xs text-muted-foreground">+{extraTags}</span>}
      {agents.length > 0 && (
        <span className="font-mono text-xs text-muted-foreground">
          {agents.slice(0, 2).join(", ")}
          {agents.length > 2 ? ` +${agents.length - 2}` : ""}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter rail                                                                 */
/* -------------------------------------------------------------------------- */

function FilterRail({
  runtime,
  setRuntime,
  security,
  setSecurity,
  minQuality,
  setMinQuality,
  category,
  setCategory,
  tag,
  setTag,
  agent,
  setAgent,
  sourceType,
  setSourceType,
  facets,
  activeFilterCount,
  onClear,
  showHeader = true,
}: {
  runtime: Runtime;
  setRuntime: (v: Runtime) => void;
  security: Security;
  setSecurity: (v: Security) => void;
  minQuality: string;
  setMinQuality: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  tag: string;
  setTag: (v: string) => void;
  agent: string;
  setAgent: (v: string) => void;
  sourceType: SourceType;
  setSourceType: (v: SourceType) => void;
  facets:
    | { categories: string[]; tags: string[]; agents: string[]; sourceTypes?: string[] }
    | undefined;
  activeFilterCount: number;
  onClear: () => void;
  showHeader?: boolean;
}) {
  return (
    <div className="space-y-6 lg:sticky lg:top-20">
      {showHeader && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide uppercase">Filters</span>
          {activeFilterCount > 0 && (
            <Button type="button" variant="ghost" size="xs" onClick={onClear} className="gap-1">
              <X aria-hidden />
              Clear
            </Button>
          )}
        </div>
      )}

      <FilterGroup label="Origin">
        <ToggleRow
          options={SOURCE_TYPE_OPTIONS}
          value={sourceType}
          onChange={(v) => setSourceType(v as SourceType)}
        />
      </FilterGroup>

      <FilterGroup label="Runtime">
        <ToggleRow
          options={RUNTIME_OPTIONS}
          value={runtime}
          onChange={(v) => setRuntime(v as Runtime)}
        />
      </FilterGroup>

      <FilterGroup label="Min quality">
        <ToggleRow options={QUALITY_OPTIONS} value={minQuality} onChange={setMinQuality} />
      </FilterGroup>

      <FilterGroup label="Security">
        <ToggleRow
          options={SECURITY_OPTIONS}
          value={security}
          onChange={(v) => setSecurity(v as Security)}
        />
      </FilterGroup>

      {facets && facets.categories.length > 0 && (
        <FilterGroup label="Category">
          <ToggleRow
            options={[
              { value: "", label: "All" },
              ...facets.categories.map((c) => ({ value: c, label: c })),
            ]}
            value={category}
            onChange={setCategory}
          />
        </FilterGroup>
      )}

      {facets && facets.tags.length > 0 && (
        <FilterGroup label="Tags">
          <ToggleRow
            options={facets.tags.map((t) => ({ value: t, label: t }))}
            value={tag}
            onChange={(v) => setTag(tag === v ? "" : v)}
            togglable
          />
        </FilterGroup>
      )}

      {facets && facets.agents.length > 0 && (
        <FilterGroup label="Agents">
          <ToggleRow
            options={facets.agents.map((a) => ({ value: a, label: a }))}
            value={agent}
            onChange={(v) => setAgent(agent === v ? "" : v)}
            togglable
          />
        </FilterGroup>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  options,
  value,
  onChange,
  togglable = false,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  togglable?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value || "__all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(togglable && active ? "" : o.value)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1 border px-2.5 text-xs transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {active && <Check className="size-3" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading + empty states                                                      */
/* -------------------------------------------------------------------------- */

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function ResultsSkeleton() {
  return (
    <div aria-hidden>
      <p className="sr-only" role="status">
        Loading skills
      </p>

      {/* Desktop: mirror the ledger rows */}
      <div className="hidden lg:block">
        {SKELETON_ROWS.map((k) => (
          <div key={k} className="flex items-start gap-6 border-b border-border py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 motion-reduce:animate-none" />
              <Skeleton className="h-3 w-32 motion-reduce:animate-none" />
              <Skeleton className="h-3 w-full max-w-prose motion-reduce:animate-none" />
            </div>
            <Skeleton className="h-4 w-44 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-12 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-12 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
          </div>
        ))}
      </div>

      {/* Phone / tablet: mirror the card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:hidden">
        {SKELETON_ROWS.slice(0, 6).map((k) => (
          <div key={k} className="space-y-3 p-8 shadow-sm ring-1 ring-foreground/5">
            <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border border-dashed border-border px-6 py-20 text-center">
      <Search className="size-8 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">
          {hasFilters ? "No skills match these filters" : "No skills published yet"}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">
          {hasFilters
            ? "Try widening the runtime, quality, or security filters, or clear them to see the full registry."
            : "Publish a skill with the Skillist CLI and it will appear here with its quality and impact scores."}
        </p>
      </div>
      {hasFilters && (
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
