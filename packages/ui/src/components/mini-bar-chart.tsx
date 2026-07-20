type BarChartProps = {
  data: { label: string; value: number }[];
  valueLabel?: string;
  className?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Axis ticks are label-agnostic: ISO dates collapse to MM-DD, anything else (a
 * version like `v1.2.0`, a short run id) renders verbatim. Callers pass whatever
 * their series is keyed by, so this must not assume dates.
 */
function tick(label: string): string {
  return ISO_DATE.test(label) ? label.slice(5) : label;
}

export function MiniBarChart({ data, valueLabel, className = "" }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const first = data[0];
  const last = data[data.length - 1];
  const unit = valueLabel ? ` ${valueLabel}` : "";
  // Single text alternative for assistive tech: the bars themselves are
  // color/height-only and keyboard-inaccessible, so summarize the series here
  // and hide the visual bars from the accessibility tree.
  const summary = `Bar chart of ${data.length} points${valueLabel ? ` (${valueLabel})` : ""}. Peak ${max}${unit}${last ? `, latest ${last.value}${unit}` : ""}.`;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={summary}>
        {data.map((point) => (
          <div
            key={point.label}
            aria-hidden="true"
            className="group flex flex-1 flex-col items-center gap-1"
            title={`${point.label}: ${point.value}${unit}`}
          >
            <div
              className="w-full bg-primary/80 transition-colors group-hover:bg-primary"
              style={{
                height: `${Math.max((point.value / max) * 100, point.value > 0 ? 8 : 0)}%`,
                minHeight: point.value > 0 ? "4px" : "0",
              }}
            />
          </div>
        ))}
      </div>
      {first && (
        <div className="flex justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
          <span className="truncate">{tick(first.label)}</span>
          {last && last !== first && <span className="truncate">{tick(last.label)}</span>}
        </div>
      )}
    </div>
  );
}
