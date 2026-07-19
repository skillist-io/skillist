import { CopyButton, cn } from "@skillist/ui";
import { AGENT_MARKS, AgentMark } from "@/components/agent-marks";

/**
 * "Connect your agent" — the credible proof behind the logo row. Skillist
 * delivers over MCP, the CLI, or a direct URL, so it works with any
 * agentskills.io / MCP client. Picking an agent shows the real config for it;
 * the CLI and URL methods below make clear the list isn't exhaustive.
 */

const ENDPOINT = "https://api.skillist.io/mcp";

type Connect = { where: string; code: string };

const GENERIC: Connect = {
  where: "Add a streamable-HTTP MCP server",
  code: `{
  "mcpServers": {
    "skillist": {
      "url": "${ENDPOINT}"
    }
  }
}`,
};

// Config conventions per client. The endpoint is identical everywhere; only the
// file/command and key differ. Docs are the source of truth for exact format.
const CONNECT: Record<string, Connect> = {
  "Claude Code": {
    where: "Terminal",
    code: `claude mcp add --transport http \\
  skillist ${ENDPOINT}`,
  },
  Cursor: {
    where: ".cursor/mcp.json",
    code: `{
  "mcpServers": {
    "skillist": { "url": "${ENDPOINT}" }
  }
}`,
  },
  "GitHub Copilot": {
    where: ".vscode/mcp.json",
    code: `{
  "servers": {
    "skillist": { "type": "http", "url": "${ENDPOINT}" }
  }
}`,
  },
  "Gemini CLI": {
    where: "~/.gemini/settings.json",
    code: `{
  "mcpServers": {
    "skillist": { "httpUrl": "${ENDPOINT}" }
  }
}`,
  },
  Codex: {
    where: "~/.codex/config.toml",
    code: `[mcp_servers.skillist]
url = "${ENDPOINT}"`,
  },
  Windsurf: {
    where: "~/.codeium/windsurf/mcp_config.json",
    code: `{
  "mcpServers": {
    "skillist": { "serverUrl": "${ENDPOINT}" }
  }
}`,
  },
  Cline: {
    where: "cline_mcp_settings.json",
    code: `{
  "mcpServers": {
    "skillist": { "type": "streamableHttp", "url": "${ENDPOINT}" }
  }
}`,
  },
  OpenCode: {
    where: "opencode.json",
    code: `{
  "mcp": {
    "skillist": { "type": "remote", "url": "${ENDPOINT}", "enabled": true }
  }
}`,
  },
};

export function AgentConnect({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const active = CONNECT[selected] ?? GENERIC;

  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-16">
      <div className="mb-8 flex flex-col gap-1.5">
        <h2 className="text-headline text-foreground">Connect your agent</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Skillist delivers over MCP, the CLI, or a direct URL, so it works with any{" "}
          <a
            href="https://agentskills.io"
            className="text-foreground underline underline-offset-4 hover:text-signal"
          >
            agentskills.io
          </a>{" "}
          or MCP client. Pick yours for the exact setup.
        </p>
      </div>

      <div className="grid gap-px border border-border bg-border lg:grid-cols-[minmax(0,15rem)_1fr]">
        {/* Agent picker */}
        <div className="flex flex-col bg-background p-2" role="tablist" aria-label="Agents">
          {AGENT_MARKS.map((agent) => {
            const isActive = agent.name === selected;
            return (
              <button
                key={agent.name}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(agent.name)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <AgentMark data={agent} className="size-5 shrink-0" />
                <span className="truncate">{agent.name}</span>
              </button>
            );
          })}
        </div>

        {/* Config panel */}
        <div className="flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-xs text-muted-foreground">{active.where}</span>
            <CopyButton value={active.code} label="Copy" size="xs" />
          </div>
          <pre className="overflow-x-auto px-5 py-5 font-mono text-[0.8125rem] leading-relaxed text-foreground">
            <code>{active.code}</code>
          </pre>
          <div className="mt-auto flex items-center gap-4 border-t border-border px-5 py-3 text-xs">
            <span className="flex items-center gap-1.5 font-semibold tracking-widest text-signal uppercase">
              <span className="inline-flex size-1.5 bg-signal" />
              Endpoint
            </span>
            <code className="font-mono text-muted-foreground">{ENDPOINT}</code>
          </div>
        </div>
      </div>

      {/* Other universal methods, so the picker isn't read as an allowlist. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 border border-border p-5">
          <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Or use the CLI
          </h3>
          <div className="flex items-center justify-between gap-2">
            <code className="truncate font-mono text-sm text-foreground">
              npm i -g @skillist/cli
            </code>
            <CopyButton value="npm i -g @skillist/cli" label="Copy" size="xs" />
          </div>
        </div>
        <div className="flex flex-col gap-2 border border-border p-5">
          <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Or fetch the URL
          </h3>
          <div className="flex items-center justify-between gap-2">
            <code className="truncate font-mono text-sm text-foreground">
              curl skillist.io/skillist/web-perf-audit/SKILL.md
            </code>
            <CopyButton
              value="curl https://skillist.io/skillist/web-perf-audit/SKILL.md"
              label="Copy"
              size="xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
