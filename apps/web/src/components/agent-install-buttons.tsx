import { CopyButton } from "@skillist/ui";

const AGENT_PATHS: Record<string, { label: string; path: string }> = {
  cursor: {
    label: "Cursor",
    path: ".cursor/skills",
  },
  claude: {
    label: "Claude Code",
    path: ".claude/skills",
  },
  vscode: {
    label: "VS Code",
    path: ".vscode/skills",
  },
};

type AgentInstallButtonsProps = {
  org: string;
  repo: string;
  agents?: string[];
  installCommand: string;
};

export function AgentInstallButtons({
  org,
  repo,
  agents = [],
  installCommand,
}: AgentInstallButtonsProps) {
  const known = agents.filter((a) => AGENT_PATHS[a]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {known.length ? (
          known.map((agent) => {
            const info = AGENT_PATHS[agent];
            if (!info) return null;
            const cmd = `skillist install ${org}/${repo} -o ${info.path}/${repo}`;
            return (
              <CopyButton
                key={agent}
                value={cmd}
                label={`Add to ${info.label}`}
                size="sm"
                variant="outline"
              />
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            Install with the CLI, then copy into your agent skills folder.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto bg-muted px-2 py-1.5 font-mono text-xs">
          {installCommand}
        </code>
        <CopyButton value={installCommand} label="Copy" size="sm" />
      </div>
    </div>
  );
}
