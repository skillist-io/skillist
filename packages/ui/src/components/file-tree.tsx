import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  Image,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "..";
import {
  buildTree,
  bundleDirs,
  isAllowedPath,
  isBinaryAssetPath,
  isProtectedPath,
  isTextPath,
  type TreeNode,
} from "../lib/bundle-paths";

type FileTreeProps = {
  files: Record<string, string>;
  pendingDirs?: string[];
  activePath: string;
  readOnly?: boolean;
  onSelect: (path: string) => void;
  onCreateFile?: (path: string) => boolean;
  onCreateDir?: (path: string) => void;
  onRename?: (from: string, to: string) => boolean;
  onDelete?: (path: string) => void;
  /** Opens the shared asset file picker (owned by the parent editor). */
  onRequestUpload?: () => void;
};

type PendingInput = { kind: "create"; parent: string } | { kind: "rename"; path: string } | null;

export function FileTree({
  files,
  pendingDirs = [],
  activePath,
  readOnly,
  onSelect,
  onCreateFile,
  onCreateDir,
  onRename,
  onDelete,
  onRequestUpload,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingInput>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const tree = buildTree(files, pendingDirs);

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const startCreate = (parent: string) => {
    setPending({ kind: "create", parent });
    setInputValue("");
    setInputError(null);
  };

  const startRename = (path: string) => {
    setPending({ kind: "rename", path });
    setInputValue(path.split("/").pop() ?? path);
    setInputError(null);
  };

  const commitInput = () => {
    if (!pending) return;
    const name = inputValue.trim();
    if (!name) {
      setPending(null);
      return;
    }
    if (pending.kind === "create") {
      const path = pending.parent ? `${pending.parent}/${name}` : name;
      if (!isTextPath(path)) {
        setInputError("Use a text extension (.md, .py, .sh, .js, .ts, .json, …)");
        return;
      }
      if (!isAllowedPath(path)) {
        setInputError("Files must live in scripts/, references/, or assets/");
        return;
      }
      if (!onCreateFile?.(path)) {
        setInputError("That file already exists");
        return;
      }
    } else {
      const dir = pending.path.split("/").slice(0, -1).join("/");
      const to = dir ? `${dir}/${name}` : name;
      const isDir = files[pending.path] === undefined;
      if (!isDir && !isTextPath(to)) {
        setInputError("Use a text extension (.md, .py, .sh, .js, .ts, .json, …)");
        return;
      }
      if (to !== pending.path && !onRename?.(pending.path, to)) {
        setInputError("Invalid or conflicting name");
        return;
      }
    }
    setPending(null);
    setInputError(null);
  };

  const inputRow = (
    <div className="px-2 py-1">
      <Input
        // Focus after the dropdown's focus guard releases — plain autoFocus
        // fires while the closing menu still holds focus and gets swallowed.
        ref={(el) => {
          if (el) requestAnimationFrame(() => el.focus());
        }}
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.target.value);
          setInputError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitInput();
          if (event.key === "Escape") setPending(null);
        }}
        className="h-7 rounded-none font-mono text-xs"
        aria-label={pending?.kind === "rename" ? "New name" : "New file name"}
      />
      {inputError && <p className="mt-1 text-xs text-destructive">{inputError}</p>}
    </div>
  );

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isDir = node.children !== undefined;
    const isCollapsed = collapsed.has(node.path);
    const renaming = pending?.kind === "rename" && pending.path === node.path;
    const canMutate = !readOnly && !isProtectedPath(node.path);

    return (
      <div key={node.path}>
        <div
          className={cn(
            "group flex items-center gap-1 pr-1",
            node.path === activePath && !isDir && "bg-accent",
          )}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isDir ? (
            <button
              type="button"
              onClick={() => toggleDir(node.path)}
              aria-expanded={!isCollapsed}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs hover:text-foreground"
            >
              {isCollapsed ? (
                <ChevronRight className="size-3 shrink-0" aria-hidden />
              ) : (
                <ChevronDown className="size-3 shrink-0" aria-hidden />
              )}
              <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{node.name}/</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              aria-current={node.path === activePath ? "true" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs hover:text-foreground",
                node.path === activePath ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {node.path === "SKILL.md" ? (
                <FileText className="size-3.5 shrink-0" aria-hidden />
              ) : isBinaryAssetPath(node.path) ? (
                <Image className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <File className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          )}
          {!readOnly && (isDir || canMutate) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 shrink-0 p-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  aria-label={`Actions for ${node.path}`}
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              {/* Keep focus on the inline rename/create input instead of the trigger. */}
              <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
                {isDir && (
                  <DropdownMenuItem onSelect={() => startCreate(node.path)}>
                    New file
                  </DropdownMenuItem>
                )}
                {canMutate && (
                  <>
                    <DropdownMenuItem onSelect={() => startRename(node.path)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(node.path)}>
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {renaming && inputRow}
        {isDir && !isCollapsed && (
          <div>
            {node.children?.map((child) => renderNode(child, depth + 1))}
            {pending?.kind === "create" && pending.parent === node.path && inputRow}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Files
        </span>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                aria-label="Add file or folder"
              >
                <Plus className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
              {bundleDirs.map((dir) => (
                <DropdownMenuItem
                  key={dir}
                  onSelect={() => {
                    // Materialize the dir node first so the inline input has
                    // somewhere to render when the folder is still empty.
                    onCreateDir?.(dir);
                    startCreate(dir);
                  }}
                >
                  New file in {dir}/
                </DropdownMenuItem>
              ))}
              {bundleDirs
                .filter(
                  (dir) => !files[dir] && !Object.keys(files).some((p) => p.startsWith(`${dir}/`)),
                )
                .map((dir) => (
                  <DropdownMenuItem key={`mk-${dir}`} onSelect={() => onCreateDir?.(dir)}>
                    Add {dir}/ folder
                  </DropdownMenuItem>
                ))}
              {!files["plugin.json"] && (
                <DropdownMenuItem onSelect={() => onCreateFile?.("plugin.json")}>
                  Add plugin.json
                </DropdownMenuItem>
              )}
              {onRequestUpload && (
                <DropdownMenuItem onSelect={onRequestUpload}>
                  Upload asset to assets/
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="py-1">
        {tree.map((node) => renderNode(node, 0))}
        {pending?.kind === "create" && pending.parent === "" && inputRow}
      </div>
      {!readOnly && (
        <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
          Text files only — binary assets ship via the CLI.
        </p>
      )}
    </div>
  );
}
