import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
            const info = AGENT_PATHS[agent]!;
            const cmd = `skillist install ${org}/${repo} -o ${info.path}/${repo}`;
            return (
              <Button
                key={agent}
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(cmd)}
              >
                Add to {info.label}
              </Button>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            Install with the CLI, then copy into your agent skills folder.
          </p>
        )}
      </div>
      <code className="block rounded bg-muted px-2 py-1 text-xs">{installCommand}</code>
      {agents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agents.map((agent) => (
            <Badge key={agent} variant="secondary">
              {agent}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
