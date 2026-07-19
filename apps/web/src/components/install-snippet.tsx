import { CopyButton } from "@skillist/ui";

export function InstallSnippet({ command, prefix }: { command: string; prefix?: string }) {
  return (
    <div className="space-y-1">
      {prefix && <p className="text-xs text-muted-foreground">{prefix}</p>}
      <div className="flex items-start gap-2">
        <code className="block flex-1 rounded-none bg-muted px-2 py-1 text-xs">{command}</code>
        <CopyButton value={command} label="Copy" size="xs" className="shrink-0" />
      </div>
    </div>
  );
}
