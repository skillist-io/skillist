import {
  api,
  Badge,
  Button,
  Card,
  CardContent,
  CopyButton,
  cn,
  formatCount,
  Input,
  Label,
  NativeSelect,
  PageTitle,
  QueryError,
  type RegistryItem,
  ScoreReadout,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  SheetTrigger,
  SignalField,
  Skeleton,
  signalFieldClass,
  TooltipProvider,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, Check, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { SignInToAddButton as AddToProjectButton } from "@/components/sign-in-cta";
import { StarStat } from "@/components/star-stat";

type Sort = (typeof SORT_VALUES)[number];
type Runtime = (typeof RUNTIME_VALUES)[number];
type Security = (typeof SECURITY_VALUES)[number];
type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

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

// Tuples shared by the TS unions and the URL schema, so an unknown ?sort= value
// is rejected at the route boundary rather than reaching the API.
const SORT_VALUES = [
  "relevance",
  "quality",
  "impact",
  "installs",
  "activations",
  "stars",
  "trending",
  "recent",
  "name",
] as const;
const RUNTIME_VALUES = ["all", "local", "sandbox", "container"] as const;
const SECURITY_VALUES = ["all", "pass", "advisory", "fail"] as const;
const SOURCE_TYPE_VALUES = ["all", "native", "mirror"] as const;

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
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

/**
 * TanStack Router types the querystring by inspecting it, so a digits-only
 * value (`?minQuality=80`, or a search for `?q=2024`) arrives as a **number**.
 * A plain `z.string()` rejects those and throws the whole route. Accept either
 * and normalise to string — every consumer downstream wants a string.
 */
const looseString = z.union([z.string(), z.number()]).transform(String);

/**
 * Filters live in the URL, not in component state, so a filtered view is a
 * place: shareable, bookmarkable, and restored by the back button. Every field
 * is optional and defaults are omitted when writing, which keeps `/registry`
 * clean until the reader actually narrows something.
 */
const searchSchema = z.object({
  q: looseString.optional(),
  sort: z.enum(SORT_VALUES).optional(),
  runtime: z.enum(RUNTIME_VALUES).optional(),
  // A number, not a string: TanStack JSON-encodes any string that looks
  // numeric, which would put `minQuality="80"` in a link meant to be shared.
  minQuality: z.coerce.number().int().min(0).max(100).optional(),
  security: z.enum(SECURITY_VALUES).optional(),
  category: looseString.optional(),
  tag: looseString.optional(),
  agent: looseString.optional(),
  sourceType: z.enum(SOURCE_TYPE_VALUES).optional(),
});

type RegistrySearch = z.infer<typeof searchSchema>;

/** Drop defaults and empties so the querystring only carries real narrowing. */
function toSearchParams(filters: RegistryFilters): RegistrySearch {
  const next: RegistrySearch = {};
  if (filters.q) next.q = filters.q;
  if (filters.sort !== INITIAL.sort) next.sort = filters.sort;
  if (filters.runtime !== INITIAL.runtime) next.runtime = filters.runtime;
  if (filters.minQuality) next.minQuality = Number(filters.minQuality);
  if (filters.security !== INITIAL.security) next.security = filters.security;
  if (filters.category) next.category = filters.category;
  if (filters.tag) next.tag = filters.tag;
  if (filters.agent) next.agent = filters.agent;
  if (filters.sourceType !== INITIAL.sourceType) next.sourceType = filters.sourceType;
  return next;
}

export const Route = createFileRoute("/registry/")({
  validateSearch: searchSchema,
  component: RegistryPage,
});

function RegistryPage() {
  const urlSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The URL is the source of truth; unset params fall back to defaults.
  // Memoised so `setFilters` — and therefore the debounce effect that depends
  // on it — is stable between renders rather than rebuilt on every one.
  const filters: RegistryFilters = useMemo(
    () => ({
      ...INITIAL,
      ...urlSearch,
      // A search wants best-match first; a browse wants best-quality first.
      // Applies only when the reader has not chosen a sort themselves, and sits
      // after the spread because an absent ?sort= arrives as undefined.
      sort: urlSearch.sort ?? (urlSearch.q ? "relevance" : INITIAL.sort),
      // The rail's option values are strings ("", "60", "80", "90").
      minQuality: urlSearch.minQuality === undefined ? "" : String(urlSearch.minQuality),
    }),
    [urlSearch],
  );
  const { sort, runtime, minQuality, security, category, tag, agent, sourceType } = filters;

  // The text input is the one control that cannot read straight from the URL:
  // it must echo every keystroke, while the URL should only record where the
  // reader stopped typing. Local state drives the field, debounced into the URL.
  const [search, setSearch] = useState(filters.q);
  const debouncedQ = filters.q;

  const setFilters = useCallback(
    (patch: Partial<RegistryFilters>) => {
      navigate({
        search: toSearchParams({ ...filters, ...patch }),
        // Filter tweaks are not distinct destinations — replacing keeps Back
        // as "leave the registry" rather than "undo one checkbox".
        replace: true,
      });
    },
    [filters, navigate],
  );

  // Reflect an externally-changed q (back/forward, a shared link) into the field.
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => setFilters({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  const queryString = buildRegistryQuery(filters);

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

  const clearFilters = useCallback(() => {
    setSearch("");
    navigate({ search: {}, replace: true });
  }, [navigate]);

  // The rail keeps its `setX` prop shape; each setter now writes one field of
  // the URL instead of one piece of component state.
  const railProps = {
    runtime,
    setRuntime: (v: Runtime) => setFilters({ runtime: v }),
    security,
    setSecurity: (v: Security) => setFilters({ security: v }),
    minQuality,
    setMinQuality: (v: string) => setFilters({ minQuality: v }),
    category,
    setCategory: (v: string) => setFilters({ category: v }),
    tag,
    setTag: (v: string) => setFilters({ tag: v }),
    agent,
    setAgent: (v: string) => setFilters({ agent: v }),
    sourceType,
    setSourceType: (v: SourceType) => setFilters({ sourceType: v }),
    facets,
    activeFilterCount,
    onClear: clearFilters,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-8">
        {/* Header band — the hero's live grid, bled to the container edges so
            the registry reads as the same surface as the landing page. Negative
            margins undo PublicLayout's padding; the content re-applies it. */}
        <header className="panel-noise relative -mx-4 -mt-8 overflow-hidden border-b border-border px-4 py-8 md:-mx-6 md:px-6">
          <SignalField className={signalFieldClass} />
          <div className="relative z-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="space-y-1">
              <PageTitle>Public Registry</PageTitle>
              <p className="max-w-prose text-sm text-muted-foreground">
                Browse Agent Skills scored for quality, impact, and security. Copy an install
                command or open a skill for the full bundle.
              </p>
            </div>
            <p className="font-mono text-sm text-muted-foreground" aria-live="polite">
              {data ? `${data.total} skill${data.total === 1 ? "" : "s"}` : " "}
            </p>
          </div>
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
              onChange={(e) => setFilters({ sort: e.target.value as Sort })}
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
              <Results
                items={data.items}
                sort={sort}
                setSort={(s: Sort) => setFilters({ sort: s })}
                query={debouncedQ}
              />
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
  query,
}: {
  items: RegistryItem[];
  sort: Sort;
  setSort: (s: Sort) => void;
  /** Active search term, so each row can explain a non-obvious match. */
  query: string;
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
              <RegistryRow key={`${item.orgSlug}/${item.skillRepo}`} item={item} query={query} />
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

/**
 * Why this row matched, when the reason is not visible in the name.
 *
 * The registry searches description and slug as well as name, so a result whose
 * title looks unrelated is otherwise inexplicable — the chip is what stops a
 * good match reading as a bad one.
 */
function matchedField(item: RegistryItem, q: string): string | null {
  const term = q.trim().toLowerCase();
  if (!term) return null;
  if (item.name?.toLowerCase().includes(term)) return null; // self-evident
  if (`${item.orgSlug}/${item.skillRepo}`.toLowerCase().includes(term)) return "repo";
  if (item.description?.toLowerCase().includes(term)) return "description";
  return null;
}

function RegistryRow({ item, query }: { item: RegistryItem; query: string }) {
  const installCmd = item.installCommand ?? `skillist install ${item.orgSlug}/${item.skillRepo}`;
  const matched = matchedField(item, query);
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
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            {item.orgSlug}/{item.skillRepo}
            {matched && (
              <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
                matched {matched}
              </span>
            )}
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
