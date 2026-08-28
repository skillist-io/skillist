/**
 * The agentskills.io / MCP clients Skillist delivers to, named in the order the
 * "Available for these agents" row and the "Connect your agent" picker show them.
 *
 * Names only, deliberately. This module previously carried each client's brand
 * glyph as a vendored SVG path (from lobe-icons, MIT). That license covers the
 * icon code, not the marks themselves — reproducing a vendor's logo needs that
 * vendor's permission, which we have not sought. Naming a client to state
 * compatibility is nominative use and needs no permission, so the marks were
 * removed and the names kept. See the trademark note in the site footer.
 *
 * If logo permission is ever granted, restore the glyphs here and give
 * <AgentLogos> and <AgentConnect> an icon slot again.
 */
export const AGENT_NAMES = [
  "Claude Code",
  "Cursor",
  "GitHub Copilot",
  "Gemini CLI",
  "Codex",
  "Windsurf",
  "Cline",
  "OpenCode",
  "MCP",
] as const;
