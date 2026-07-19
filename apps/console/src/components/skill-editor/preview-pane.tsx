import { parseSkillMd } from "@skillist/skill-format";
import { FrontmatterCard, languageForPath, Skeleton } from "@skillist/ui";
import { lazy, Suspense, useDeferredValue } from "react";

const MarkdownView = lazy(() => import("@skillist/ui/markdown-view"));

export function PreviewPane({
  path,
  content,
  files,
  onOpenFile,
}: {
  path: string;
  content: string;
  files: Record<string, string>;
  onOpenFile: (path: string) => void;
}) {
  // Defer so fast typing in the editor never blocks on markdown re-rendering.
  const deferred = useDeferredValue(content);
  const isSkillMd = path === "SKILL.md";
  const parsed = isSkillMd ? parseSkillMd(deferred) : null;
  const body = parsed ? parsed.body : deferred;

  if (languageForPath(path) !== "markdown") {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Preview renders markdown files — {path} is shown in the editor only.
      </p>
    );
  }

  return (
    <div className="max-h-[560px] space-y-4 overflow-auto p-3">
      {isSkillMd &&
        (parsed ? (
          <FrontmatterCard frontmatter={parsed.frontmatter} />
        ) : (
          <div className="border border-destructive/40 p-3 text-xs text-muted-foreground">
            Frontmatter missing or invalid — add a YAML block between <code>---</code> fences.
          </div>
        ))}
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-none" />}>
        <MarkdownView markdown={body} files={files} onOpenFile={onOpenFile} />
      </Suspense>
    </div>
  );
}
