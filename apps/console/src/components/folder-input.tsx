import { cn, Input } from "@skillist/ui";
import { useId } from "react";

type FolderInputProps = Omit<React.ComponentProps<"input">, "list"> & {
  /** Existing folder paths in the project, used to seed autocomplete. */
  folders: string[];
};

/**
 * A folder-path text field with a native <datalist> of the project's existing
 * folders. Free text is still allowed (typing a new path creates a new folder);
 * the datalist only offers known paths so re-filing stays consistent. Mono, so
 * machine paths read as machine values.
 */
export function FolderInput({ folders, className, ...props }: FolderInputProps) {
  const listId = useId();
  return (
    <>
      <Input list={listId} className={cn("font-mono text-xs", className)} {...props} />
      <datalist id={listId}>
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
    </>
  );
}
