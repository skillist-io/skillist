import {
  api,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type Coverage,
  type CoverageSkill,
  cn,
  PageTitle,
  QueryError,
  Skeleton,
} from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { useActiveOrg } from "@/lib/active-org";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/coverage")({
  beforeLoad: () => requireAuth(),
  component: CoveragePage,
});

// md+ column template for the three-layer table. One flexible ref column, then
// the published / covered / activated layers, then last-activated.
const ROW_GRID =
  "grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_7rem_13rem_14rem_8rem] md:items-baseline";

function CoveragePage() {
  const { activeOrg } = useActiveOrg();
  const activeOrgId = activeOrg?.id ?? "";

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["coverage", activeOrgId],
    queryFn: () => api<Coverage>(`/v1/orgs/${activeOrgId}/coverage`),
    enabled: !!activeOrgId,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <PageTitle>Coverage</PageTitle>
        <p className="text-muted-foreground">
          Required skills across three layers — published in the registry, covered in scanned repos
          and projects, then activated by agents in the field
        </p>
      </div>

      {!activeOrgId ? (
        <p className="text-muted-foreground">Select an organization to view coverage.</p>
      ) : isLoading ? (
        <CoverageSkeleton />
      ) : isError ? (
        <QueryError
          title="Could not load coverage"
          message="We couldn't reach the coverage API for this organization. Try again."
          onRetry={() => refetch()}
        />
      ) : data && data.summary.required > 0 ? (
        <CoverageBody data={data} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function CoverageBody({ data }: { data: Coverage }) {
  // Drifted (uncovered) rows are the actionable set — sort them to the top,
  // then unpublished, then alphabetically by ref for a stable order.
  const skills = [...data.skills].sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    if (a.published !== b.published) return a.published ? 1 : -1;
    return a.ref.localeCompare(b.ref);
  });

  return (
    <div className="space-y-8">
      <SummaryRow summary={data.summary} />
      {data.drift.length > 0 ? <DriftCallout refs={data.drift} /> : null}
      <SkillTable skills={skills} />
    </div>
  );
}

function SummaryRow({ summary }: { summary: Coverage["summary"] }) {
  const pct = Math.max(0, Math.min(100, Math.round(summary.coveragePct)));
  return (
    <Card size="sm">
      <CardHeader className="pb-4">
        <CardDescription>Required-skill coverage</CardDescription>
        <div className="flex items-end justify-between gap-4">
          <CardTitle className="text-4xl tabular-nums">{pct}%</CardTitle>
          <span className="pb-1 font-mono text-xs text-muted-foreground tabular-nums">
            {summary.covered} / {summary.required} covered
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Required-skill coverage: ${pct} percent`}
          className="h-2 w-full border border-border bg-muted"
        >
          <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Stat label="Required" value={summary.required} />
          <Stat label="Published" value={summary.published} />
          <Stat label="Covered" value={summary.covered} />
          <Stat label="Activated" value={summary.activated} />
          <Stat label="Drifted" value={summary.drifted} emphasize={summary.drifted > 0} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 font-mono text-2xl tabular-nums",
          emphasize ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function DriftCallout({ refs }: { refs: string[] }) {
  return (
    <section
      aria-labelledby="drift-heading"
      className="border border-destructive/40 bg-destructive/5 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 space-y-3">
          <div>
            <h2
              id="drift-heading"
              className="text-[0.625rem] font-semibold tracking-widest text-destructive uppercase"
            >
              Drift — {refs.length} required {refs.length === 1 ? "skill" : "skills"} not covered
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These required skills are not installed in any scanned repo or curated into any
              project. Agents can't use what isn't present — bring them into inventory or a project
              to close the gap.
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {refs.map((ref) => (
              <li key={ref} className="font-mono text-sm text-foreground">
                {ref}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SkillTable({ skills }: { skills: CoverageSkill[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Required skills</CardTitle>
        <CardDescription>
          Published → covered → activated, per required skill. Uncovered skills are listed first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-t border-border">
          {/* Header — visible on md+; each row repeats labels inline on mobile. */}
          <div
            className={cn(
              ROW_GRID,
              "hidden border-b border-border py-2 md:grid",
              "text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase",
            )}
          >
            <span>Skill</span>
            <span>Published</span>
            <span>Covered</span>
            <span>Activated</span>
            <span>Last active</span>
          </div>
          {skills.map((skill) => (
            <SkillRow key={skill.ref} skill={skill} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SkillRow({ skill }: { skill: CoverageSkill }) {
  return (
    <div className={cn(ROW_GRID, "border-b border-border py-4 last:border-b-0")}>
      <div className="min-w-0">
        <p className="truncate font-mono text-sm text-foreground">{skill.ref}</p>
        {!skill.covered ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Not in any repo or project</p>
        ) : null}
      </div>

      <LayerCell
        label="Published"
        ok={skill.published}
        okLabel="Published"
        badLabel="Unpublished"
      />

      <LayerCell
        label="Covered"
        ok={skill.covered}
        okLabel="Covered"
        badLabel="Drift"
        danger
        detail={`${skill.inventoryCount} ${skill.inventoryCount === 1 ? "repo" : "repos"} · ${skill.projectCount} ${skill.projectCount === 1 ? "project" : "projects"}`}
      />

      <LayerCell
        label="Activated"
        ok={skill.activated}
        okLabel="Active"
        badLabel="Idle"
        detail={`${skill.activations} ${skill.activations === 1 ? "activation" : "activations"} · ${skill.installs} ${skill.installs === 1 ? "install" : "installs"}`}
      />

      <div className="min-w-0">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase md:hidden">
          Last active{" "}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatRelative(skill.lastActivatedAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * A single coverage layer as icon + word (never color alone). `danger` renders
 * the "off" state in destructive red because an uncovered required skill is a
 * failure the governing team must fix; other off-states stay neutral ink.
 */
function LayerCell({
  label,
  ok,
  okLabel,
  badLabel,
  danger = false,
  detail,
}: {
  label: string;
  ok: boolean;
  okLabel: string;
  badLabel: string;
  danger?: boolean;
  detail?: string;
}) {
  const Icon = ok ? Check : danger ? AlertTriangle : Minus;
  return (
    <div className="min-w-0">
      <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase md:hidden">
        {label}:{" "}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase",
          ok ? "text-foreground" : danger ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {ok ? okLabel : badLabel}
      </span>
      {detail ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">{detail}</p>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>No required skills yet</CardTitle>
        <CardDescription>
          Coverage tracks the skills your organization requires. None are defined for this org yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Set required skills in{" "}
          <Link to="/governance" className="text-foreground underline underline-offset-4">
            Governance
          </Link>{" "}
          to start measuring published → covered → activated coverage across your repos and
          projects.
        </p>
      </CardContent>
    </Card>
  );
}

function CoverageSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-busy="true" aria-label="Loading coverage">
      <Card size="sm">
        <CardHeader className="pb-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-9 w-24" />
        </CardHeader>
        <CardContent className="space-y-5">
          <Skeleton className="h-2 w-full" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {["required", "published", "covered", "activated", "drifted"].map((k) => (
              <div key={k} className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatRelative(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(Math.round(seconds), "second");
}
