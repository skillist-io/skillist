import type { SkillBundle } from "@skillist/skill-format";

export type SkillRuntime = "local" | "sandbox" | "container";

const SCRIPT_EXTENSIONS = [".sh", ".bash", ".js", ".mjs", ".cjs", ".ts", ".py"];

export function listRunnableScripts(bundle: SkillBundle): string[] {
  return [...bundle.keys()]
    .filter((p) => p.startsWith("scripts/"))
    .filter((p) => SCRIPT_EXTENSIONS.some((ext) => p.endsWith(ext)))
    .sort();
}

export function detectSkillRuntime(bundle: SkillBundle): SkillRuntime {
  const scripts = listRunnableScripts(bundle);
  if (scripts.length === 0) return "local";

  const plugin = bundle.get("plugin.json");
  if (plugin) {
    try {
      const manifest = JSON.parse(plugin) as {
        metadata?: { runtime?: string };
      };
      if (manifest.metadata?.runtime === "container") return "container";
    } catch {
      // ignore
    }
  }

  const hasHeavy = scripts.some(
    (s) => s.includes("wrangler") || s.includes("deploy") || s.includes("preflight"),
  );
  if (hasHeavy || bundle.has("assets/wrangler.template.jsonc")) {
    return "container";
  }

  return "sandbox";
}

export function validateScriptPath(path: string): boolean {
  if (!path.startsWith("scripts/")) return false;
  if (path.includes("..")) return false;
  if (!SCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  return true;
}

export function buildExecCommand(scriptPath: string, args: string[] = []): string {
  const quotedArgs = args.map((a) => shellQuote(a)).join(" ");
  const argSuffix = quotedArgs ? ` ${quotedArgs}` : "";

  if (scriptPath.endsWith(".sh") || scriptPath.endsWith(".bash")) {
    return `bash ${shellQuote(scriptPath)}${argSuffix}`;
  }
  if (scriptPath.endsWith(".js") || scriptPath.endsWith(".mjs")) {
    return `node ${shellQuote(scriptPath)}${argSuffix}`;
  }
  if (scriptPath.endsWith(".cjs")) {
    return `node ${shellQuote(scriptPath)}${argSuffix}`;
  }
  if (scriptPath.endsWith(".ts")) {
    return `npx tsx ${shellQuote(scriptPath)}${argSuffix}`;
  }
  if (scriptPath.endsWith(".py")) {
    return `python3 ${shellQuote(scriptPath)}${argSuffix}`;
  }
  throw new Error(`Unsupported script type: ${scriptPath}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function validateTargetUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid target URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Target URL must be http or https");
  }
  const host = parsed.hostname;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("172.16.") ||
    host === "0.0.0.0"
  ) {
    throw new Error("Target URL must be a public address");
  }
  return parsed.toString();
}

export const EXEC_TIMEOUT_MS = 120_000;
export const CONTAINER_TIMEOUT_MS = 180_000;
export const MAX_OUTPUT_CHARS = 256_000;
