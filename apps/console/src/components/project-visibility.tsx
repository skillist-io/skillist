import type { ProjectVisibility } from "@skillist/ui";
import { Badge, cn } from "@skillist/ui";
import { Lock, Users } from "lucide-react";

export const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
  private: "Private",
  shared: "Shared",
};

export const VISIBILITY_HELP: Record<ProjectVisibility, string> = {
  private: "Only you and people you add",
  shared: "Everyone in the org, by role",
};

const VISIBILITY_ICON = {
  private: Lock,
  shared: Users,
} as const;

/**
 * Text-only visibility badge with an icon (never color-only): a Lock for
 * private, Users for shared. Matches the squared, uppercase badge vocabulary.
 */
export function ProjectVisibilityBadge({
  visibility,
  className,
}: {
  visibility: ProjectVisibility;
  className?: string;
}) {
  const Icon = VISIBILITY_ICON[visibility];
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden />
      {VISIBILITY_LABEL[visibility]}
    </Badge>
  );
}

/**
 * Quiet inline visibility indicator for dense tree rows: a small muted icon
 * with an sr-only label so status is never conveyed by shape alone.
 */
export function ProjectVisibilityIcon({
  visibility,
  className,
}: {
  visibility: ProjectVisibility;
  className?: string;
}) {
  const Icon = VISIBILITY_ICON[visibility];
  return (
    <>
      <Icon className={cn("size-3 shrink-0 text-muted-foreground", className)} aria-hidden />
      <span className="sr-only">{VISIBILITY_LABEL[visibility]} project</span>
    </>
  );
}
