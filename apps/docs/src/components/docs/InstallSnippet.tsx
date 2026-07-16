export function InstallSnippet({ command, prefix }: { command: string; prefix?: string }) {
  return (
    <div className="not-content space-y-1">
      {prefix ? (
        <p className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          {prefix}
        </p>
      ) : null}
      <code className="block bg-muted px-3 py-2 font-mono text-xs ring-1 ring-foreground/5">
        {command}
      </code>
    </div>
  );
}
