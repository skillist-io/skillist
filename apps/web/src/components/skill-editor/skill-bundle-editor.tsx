import * as Tabs from "@radix-ui/react-tabs";
import {
  base64DecodedSize,
  encodeBase64,
  MAX_BINARY_ASSET_BYTES,
  type ValidationError,
} from "@skillist/skill-format";
import { Columns2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssetPreview, formatBytes } from "./asset-preview";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";
import { FileTree } from "./file-tree";
import { FrontmatterForm } from "./frontmatter-form";
import { languageForPath } from "./highlight";
import {
  BINARY_ASSET_EXTENSIONS,
  isBinaryAssetPath,
  isTextPath,
  sanitizeAssetFileName,
} from "./paths";
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
  const assetInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const activeContent = bundle.files[bundle.activePath];
  const isSkillMd = bundle.activePath === "SKILL.md";
  const activeIsText = isTextPath(bundle.activePath) || isSkillMd;
  const activeIsBinary = isBinaryAssetPath(bundle.activePath);
  const previewable = languageForPath(bundle.activePath) === "markdown";

  const uploadAsset = async (file: File): Promise<string | null> => {
    if (!isBinaryAssetPath(file.name)) {
      return "Unsupported file type — use png, jpg, gif, webp, ico, pdf, or zip.";
    }
    if (file.size > MAX_BINARY_ASSET_BYTES) {
      return `File exceeds the ${MAX_BINARY_ASSET_BYTES / (1024 * 1024)}MB limit.`;
    }
    const path = `assets/${sanitizeAssetFileName(file.name)}`;
    const base64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    if (bundle.files[path] === undefined && !bundle.createFile(path)) {
      return "Could not create that file.";
    }
    bundle.setFileContent(path, base64);
    bundle.setActivePath(path);
    return null;
  };

  const editor =
    activeContent === undefined ? (
      <p className="p-4 text-sm text-muted-foreground">Select a file to edit.</p>
    ) : activeIsBinary ? (
      <AssetPreview
        path={bundle.activePath}
        base64Content={activeContent}
        onReplace={() => assetInputRef.current?.click()}
      />
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
          onRequestUpload={() => assetInputRef.current?.click()}
        />
        <input
          ref={assetInputRef}
          type="file"
          accept={BINARY_ASSET_EXTENSIONS.join(",")}
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploadError(await uploadAsset(file));
          }}
        />
        {uploadError && (
          <p className="border-t border-border px-2 py-1.5 text-xs text-destructive">
            {uploadError}
          </p>
        )}
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
                {activeIsBinary
                  ? formatBytes(base64DecodedSize(activeContent ?? ""))
                  : `${(activeContent ?? "").split("\n").length} lines · ${(activeContent ?? "").length} chars`}
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
