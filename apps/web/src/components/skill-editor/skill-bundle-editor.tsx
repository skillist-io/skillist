import * as Tabs from "@radix-ui/react-tabs";
import type { ValidationError } from "@skillist/skill-format";
import { Columns2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";
import { FileTree } from "./file-tree";
import { FrontmatterForm } from "./frontmatter-form";
import { languageForPath } from "./highlight";
import { isTextPath } from "./paths";
import { PreviewPane } from "./preview-pane";
import type { SkillBundleState } from "./use-skill-bundle";

const TAB_TRIGGER_CLASSES =
  "border-b-2 border-transparent px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground";

export function SkillBundleEditor({
  bundle,
  repoSlug,
  validationErrors = [],
  errorLines,
  editorRef,
}: {
  bundle: SkillBundleState;
  repoSlug: string;
  validationErrors?: ValidationError[];
  errorLines?: Set<number>;
  editorRef?: React.Ref<CodeEditorHandle>;
}) {
  const fallbackEditorRef = useRef<CodeEditorHandle>(null);
  const [showPreview, setShowPreview] = useState(true);
  const activeContent = bundle.files[bundle.activePath];
  const isSkillMd = bundle.activePath === "SKILL.md";
  const activeIsText = isTextPath(bundle.activePath) || isSkillMd;
  const previewable = languageForPath(bundle.activePath) === "markdown";

  const editor =
    activeContent === undefined ? (
      <p className="p-4 text-sm text-muted-foreground">Select a file to edit.</p>
    ) : activeIsText ? (
      <CodeEditor
        ref={editorRef ?? fallbackEditorRef}
        path={bundle.activePath}
        value={activeContent}
        onChange={(next) => bundle.setFileContent(bundle.activePath, next)}
        errorLines={isSkillMd ? errorLines : undefined}
      />
    ) : (
      <p className="p-4 text-sm text-muted-foreground">{bundle.activePath} is not editable here.</p>
    );

  return (
    <div className="grid grid-cols-1 border border-border md:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="border-b border-border md:border-r md:border-b-0">
        <FileTree
          files={bundle.files}
          pendingDirs={bundle.pendingDirs}
          activePath={bundle.activePath}
          onSelect={bundle.setActivePath}
          onCreateFile={bundle.createFile}
          onCreateDir={bundle.createDir}
          onRename={bundle.renamePath}
          onDelete={bundle.deletePath}
        />
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "grid grid-cols-1",
            showPreview && previewable && "xl:grid-cols-2 xl:divide-x xl:divide-border",
          )}
        >
          <div className="min-w-0">
            {isSkillMd ? (
              <Tabs.Root defaultValue="source">
                <div className="flex items-center justify-between border-b border-border pr-1">
                  <Tabs.List aria-label="SKILL.md editing mode">
                    <Tabs.Trigger value="source" className={TAB_TRIGGER_CLASSES}>
                      Source
                    </Tabs.Trigger>
                    <Tabs.Trigger value="frontmatter" className={TAB_TRIGGER_CLASSES}>
                      Frontmatter
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden h-6 gap-1 px-1.5 text-xs xl:flex"
                    onClick={() => setShowPreview((prev) => !prev)}
                    aria-pressed={showPreview}
                  >
                    <Columns2 className="size-3.5" aria-hidden />
                    {showPreview ? "Hide preview" : "Show preview"}
                  </Button>
                </div>
                <Tabs.Content value="source" className="p-2">
                  {editor}
                </Tabs.Content>
                <Tabs.Content value="frontmatter" className="max-h-[560px] overflow-auto p-3">
                  <FrontmatterForm
                    content={activeContent ?? ""}
                    repoSlug={repoSlug}
                    errors={validationErrors}
                    onChange={(next) => bundle.setFileContent("SKILL.md", next)}
                  />
                </Tabs.Content>
              </Tabs.Root>
            ) : (
              <div className="p-2">{editor}</div>
            )}
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {bundle.dirty && (
                  <span
                    className="size-1.5 rounded-full bg-signal"
                    title="Unsaved changes"
                    aria-hidden
                  />
                )}
                {bundle.activePath}
                {bundle.dirty && <span className="sr-only">(unsaved changes)</span>}
              </span>
              <span>
                {(activeContent ?? "").split("\n").length} lines · {(activeContent ?? "").length}{" "}
                chars
              </span>
            </div>
          </div>
          {showPreview && previewable && (
            <div className="hidden min-w-0 xl:block">
              <div className="border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Preview
              </div>
              <PreviewPane
                path={bundle.activePath}
                content={activeContent ?? ""}
                files={bundle.files}
                onOpenFile={bundle.setActivePath}
              />
            </div>
          )}
        </div>
        {previewable && (
          <details className="border-t border-border xl:hidden">
            <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Preview
            </summary>
            <PreviewPane
              path={bundle.activePath}
              content={activeContent ?? ""}
              files={bundle.files}
              onOpenFile={bundle.setActivePath}
            />
          </details>
        )}
      </div>
    </div>
  );
}
