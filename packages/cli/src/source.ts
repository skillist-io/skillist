export type SourceType = "claude" | "agents" | "cursor" | "gemini" | "codex" | "vscode" | "unknown";

export type SkillScope = "user" | "project" | "plugin" | "unknown";

/**
 * Infer ecosystem from path. Rightmost marker wins so nested marketplaces
 * report the inner agent tree (e.g. cursor inside a Claude marketplace).
 */
export function inferType(absPath: string): SourceType {
  const p = absPath.split(/[/\\]/).join("/");
  const markers: Array<[string, SourceType]> = [
    ["/.claude/", "claude"],
    ["/.cursor/", "cursor"],
    ["/.gemini/", "gemini"],
    ["/.codex/", "codex"],
    ["/.agents/", "agents"],
    ["/.vscode/", "vscode"],
  ];
  let bestType: SourceType = "unknown";
  let bestIdx = -1;
  for (const [marker, type] of markers) {
    const idx = p.lastIndexOf(marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestType = type;
    }
  }
  return bestType;
}

export function inferScope(absPath: string): SkillScope {
  const p = absPath.split(/[/\\]/).join("/");
  if (p.includes("/.claude/plugins/")) return "plugin";
  const home = (process.env.HOME ?? process.env.USERPROFILE ?? "") + "/";
  if (
    home.length > 1 &&
    p.startsWith(home) &&
    (p.includes("/.claude/") ||
      p.includes("/.agents/") ||
      p.includes("/.cursor/") ||
      p.includes("/.gemini/") ||
      p.includes("/.codex/") ||
      p.includes("/.vscode/"))
  ) {
    return "user";
  }
  if (
    p.includes("/.claude/") ||
    p.includes("/.agents/") ||
    p.includes("/.cursor/") ||
    p.includes("/.gemini/") ||
    p.includes("/.codex/") ||
    p.includes("/.vscode/")
  ) {
    return "project";
  }
  return "unknown";
}

export function inferMarketplace(absPath: string): { marketplace?: string; pluginName?: string } {
  const p = absPath.split(/[/\\]/).join("/");
  const m = p.match(/\/\.claude\/plugins\/marketplaces\/([^/]+)\/(.*?)\/?skills\//);
  if (!m) return {};
  const marketplace = m[1];
  const between = m[2] ?? "";
  const result: { marketplace?: string; pluginName?: string } = { marketplace };
  const pluginMatch = between.match(/^plugins\/([^/]+)$/);
  if (pluginMatch) result.pluginName = pluginMatch[1];
  return result;
}
