type BarChartProps = {
  data: { label: string; value: number }[];
  valueLabel?: string;
  className?: string;
};

export function MiniBarChart({ data, valueLabel, className = "" }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
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
      <div className="flex gap-1 text-[10px] text-muted-foreground">
        {data.map((point, index) => (
          <span key={point.label} className="flex-1 truncate text-center">
            {index === 0 || index === data.length - 1 || index % 7 === 0
              ? point.label.slice(5)
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
