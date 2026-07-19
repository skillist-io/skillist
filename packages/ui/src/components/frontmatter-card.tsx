import { Badge } from "..";

type LooseFrontmatter = {
  name?: unknown;
  description?: unknown;
  license?: unknown;
  compatibility?: unknown;
  metadata?: unknown;
  "allowed-tools"?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function FrontmatterCard({ frontmatter }: { frontmatter: unknown }) {
  const fm = (frontmatter ?? {}) as LooseFrontmatter;
  const metadata =
    fm.metadata && typeof fm.metadata === "object" && !Array.isArray(fm.metadata)
      ? Object.entries(fm.metadata as Record<string, unknown>)
      : [];
  const rows: Array<[string, string]> = [];
  const license = text(fm.license);
  const compatibility = text(fm.compatibility);
  if (license) rows.push(["License", license]);
  if (compatibility) rows.push(["Compatibility", compatibility]);

  return (
    <div className="border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{text(fm.name) ?? "unnamed-skill"}</span>
        {text(fm["allowed-tools"]) && (
          <Badge variant="outline" title="Pre-approved tools (experimental)">
            tools: {text(fm["allowed-tools"])}
          </Badge>
        )}
      </div>
      {text(fm.description) && (
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{text(fm.description)}</p>
      )}
      {(rows.length > 0 || metadata.length > 0) && (
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
          {metadata.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-words">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
