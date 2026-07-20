import { useId } from "react";
import { cn } from "../utils";

/**
 * A compact set of mutually-exclusive choices — time ranges, densities, depths.
 *
 * Reach for this over a select when there are ≤4 short options and the current
 * value matters at a glance: the whole set stays visible, so the reader sees
 * what else is available without opening anything. Past four, or with long
 * labels, use a NativeSelect instead.
 *
 * Built on real radio inputs rather than buttons with `role="radio"`. The
 * browser then supplies arrow-key navigation, roving focus, and group semantics
 * for free — all things a hand-rolled version gets subtly wrong — and the
 * visible control is the styled label wrapping each input.
 *
 * Values are set in mono because they are almost always machine quantities
 * (7 / 30 / 90), which also stops the row reflowing as the active segment
 * changes weight.
 */
export type SegmentedOption<T extends string | number> = {
  value: T;
  label: string;
  /** Announced instead of `label` when the glyph alone is not self-describing. */
  srLabel?: string;
};

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Visible caption; also names the group for assistive tech. */
  label?: string;
  className?: string;
}) {
  // Groups radios so arrow keys move within this control and not another on
  // the same page.
  const name = useId();

  // min-w-0: a <fieldset> defaults to `min-inline-size: min-content`, which
  // stops it shrinking and makes it overflow a tight flex row.
  return (
    <fieldset className={cn("m-0 flex min-w-0 items-center gap-2 border-0 p-0", className)}>
      {label && (
        <legend className="float-left text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          {label}
        </legend>
      )}
      {/* gap-px over a bordered box: the rule between segments is the box's own
          background showing through, so there are no doubled borders. */}
      <div className="flex gap-px border border-border bg-border p-px">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={cn(
                "cursor-pointer px-2.5 py-1 font-mono text-xs transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                selected
                  ? "bg-secondary font-semibold text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.srLabel ? <span className="sr-only">{option.srLabel}</span> : null}
              <span aria-hidden={option.srLabel ? true : undefined}>{option.label}</span>
            </label>
          );
        })}
      </div>
      ;
    </fieldset>
  );
}
