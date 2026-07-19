import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  usePublicBundle,
} from "@skillist/ui";
import { ArrowLeft } from "lucide-react";
import { AssetPreview } from "@/components/skill-editor/asset-preview";
import { FileTree } from "@/components/skill-editor/file-tree";
import { isBinaryAssetPath, isTextPath } from "@/components/skill-editor/paths";

/** Read-only directory tree + file viewer for a published bundle (public page rail). */
export default function SkillBundleBrowser({
  org,
  repo,
  etag,
  viewedPath,
  onViewPath,
}: {
  org: string;
  repo: string;
  etag?: string;
  viewedPath: string | null;
  onViewPath: (path: string | null) => void;
}) {
  const { data, isError } = usePublicBundle(org, repo, etag);
  if (isError || !data) return null;

  const viewedContent = viewedPath ? data.files[viewedPath] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bundle contents</CardTitle>
        <CardDescription>agentskills.io directory structure · v{data.version}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {viewedPath && viewedContent !== undefined ? (
          <div>
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs"
                onClick={() => onViewPath(null)}
              >
                <ArrowLeft className="size-3" aria-hidden /> Files
              </Button>
              <span className="truncate font-mono text-xs text-muted-foreground">{viewedPath}</span>
            </div>
            {isBinaryAssetPath(viewedPath) ? (
              <AssetPreview path={viewedPath} base64Content={viewedContent} />
            ) : (
              <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre">
                {viewedContent}
              </pre>
            )}
          </div>
        ) : (
          <FileTree
            files={data.files}
            activePath={viewedPath ?? ""}
            readOnly
            onSelect={(path) => {
              if (isTextPath(path) || isBinaryAssetPath(path) || path === "SKILL.md") {
                onViewPath(path);
              }
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
