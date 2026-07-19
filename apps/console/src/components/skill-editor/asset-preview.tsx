import { base64DecodedSize, binaryAssetMimeType } from "@skillist/skill-format";
import { Button } from "@skillist/ui";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a binary bundle asset (image preview, or a generic icon for non-image types like PDFs/zips). */
export function AssetPreview({
  path,
  base64Content,
  onReplace,
}: {
  path: string;
  base64Content: string;
  onReplace?: () => void;
}) {
  const mime = binaryAssetMimeType(path);
  const isImage = mime.startsWith("image/");
  const size = formatBytes(base64DecodedSize(base64Content));

  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      {isImage ? (
        <img
          src={`data:${mime};base64,${base64Content}`}
          alt={path}
          className="max-h-64 max-w-full border border-border object-contain"
        />
      ) : (
        <div className="flex size-24 items-center justify-center border border-border bg-muted text-xs text-muted-foreground uppercase">
          {mime.split("/")[1] ?? "file"}
        </div>
      )}
      <p className="font-mono text-xs text-muted-foreground">
        {path} · {size}
      </p>
      {onReplace && (
        <Button type="button" variant="outline" size="sm" onClick={onReplace}>
          Replace
        </Button>
      )}
    </div>
  );
}
