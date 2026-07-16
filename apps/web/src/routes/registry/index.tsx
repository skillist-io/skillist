import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type RegistryItem } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScoreBadges, InstallSnippet } from "@/components/score-badges";
import { useEffect, useState } from "react";

type RegistryFilters = {
  q: string;
  sort: "quality" | "impact" | "installs" | "activations" | "recent" | "name";
  runtime: "all" | "local" | "sandbox" | "container";
  minQuality: string;
  security: "all" | "pass" | "advisory" | "fail";
};

function buildRegistryQuery(filters: RegistryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  params.set("sort", filters.sort);
  params.set("runtime", filters.runtime);
  if (filters.minQuality) params.set("minQuality", filters.minQuality);
  params.set("security", filters.security);
  return params.toString();
}

export const Route = createFileRoute("/registry/")({
  component: RegistryPage,
});

function RegistryPage() {
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<RegistryFilters["sort"]>("quality");
  const [runtime, setRuntime] = useState<RegistryFilters["runtime"]>("all");
  const [minQuality, setMinQuality] = useState("");
  const [security, setSecurity] = useState<RegistryFilters["security"]>("all");

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
  });

  const { data, isLoading } = useQuery({
    queryKey: ["registry", queryString],
    queryFn: () =>
      api<{ items: RegistryItem[]; total: number }>(
        `/v1/registry?${queryString}`,
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Public Registry</h1>
        <p className="text-muted-foreground">
          Discover Agent Skills with quality, impact, and security scores
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Label>Search</Label>
          <Input
            placeholder="Name, description, or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label>Sort by</Label>
          <select
            className="mt-0 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as RegistryFilters["sort"])}
          >
            <option value="quality">Quality</option>
            <option value="impact">Impact</option>
            <option value="installs">Installs</option>
            <option value="activations">Activations</option>
            <option value="recent">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div>
          <Label>Runtime</Label>
          <select
            className="mt-0 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={runtime}
            onChange={(e) =>
              setRuntime(e.target.value as RegistryFilters["runtime"])
            }
          >
            <option value="all">All</option>
            <option value="sandbox">Sandbox</option>
            <option value="container">Container</option>
            <option value="local">Local only</option>
          </select>
        </div>
        <div>
          <Label>Min quality</Label>
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="Any"
            value={minQuality}
            onChange={(e) => setMinQuality(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-muted-foreground">Security</Label>
        {(["all", "pass", "advisory", "fail"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              security === value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background"
            }`}
            onClick={() => setSecurity(value)}
          >
            {value}
          </button>
        ))}
        {data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {data.total} skill{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.items.map((item) => (
            <Card key={`${item.orgSlug}/${item.skillSlug}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    <CardDescription>
                      {item.orgSlug}/{item.skillSlug}
                    </CardDescription>
                  </div>
                  {item.latestVersion && (
                    <Badge>v{item.latestVersion}</Badge>
                  )}
                </div>
                <ScoreBadges
                  quality={item.qualityScore}
                  impact={item.impactScore}
                  security={item.securityStatus}
                />
                {item.runtime && item.runtime !== "local" && (
                  <Badge variant="secondary" className="text-xs">
                    {item.runtime} runtime
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{item.description}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{item.installCount} installs</span>
                  <span>{item.activationCount} activations</span>
                  <span>{item.stars} stars</span>
                </div>
                <InstallSnippet
                  command={
                    item.installCommand ??
                    `skillist install ${item.orgSlug}/${item.skillSlug}`
                  }
                />
                <Link
                  to="/registry/$org/$slug"
                  params={{ org: item.orgSlug, slug: item.skillSlug }}
                  className="text-sm text-primary hover:underline"
                >
                  View skill →
                </Link>
              </CardContent>
            </Card>
          ))}
          {data?.items.length === 0 && (
            <p className="text-muted-foreground">
              No skills match your filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
