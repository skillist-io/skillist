import { cn } from "@/lib/utils";

export function SectionHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("not-content mb-4 space-y-1", className)}>
      <h2 className="font-heading text-xl font-semibold tracking-wider uppercase">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
