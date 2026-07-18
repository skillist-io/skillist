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

/** True for an IPv4 dotted-quad in a loopback/private/link-local/reserved range. */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  // Any octet > 255 is malformed — fail closed rather than let it through.
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private (full range)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/3 multicast + reserved
  return false;
}

/** True for an IPv6 literal (brackets optional) that is loopback/ULA/link-local/mapped-private. */
function isPrivateIPv6(host: string): boolean {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h.includes(":")) return false;
  h = h.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  // IPv4-mapped/embedded, dotted form: ::ffff:127.0.0.1
  const dottedTail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dottedTail && isPrivateIPv4(dottedTail[1] as string)) return true;
  const firstHextet = Number.parseInt(h.split(":")[0] || "0", 16);
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 unique-local
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 link-local
  return false;
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
  // The WHATWG URL parser canonicalizes decimal/octal/hex IPv4 encodings
  // (e.g. http://2130706433, http://0x7f.1) to dotted-quad in `hostname`,
  // so the numeric-encoding bypass is closed before we inspect it here.
  const host = parsed.hostname.toLowerCase();
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    bareHost === "" ||
    isPrivateIPv4(bareHost) ||
    isPrivateIPv6(host)
  ) {
    throw new Error("Target URL must be a public address");
  }
  // Residual risk: a public hostname that resolves to a private address
  // (DNS rebinding) cannot be caught here without resolving it; the sandbox's
  // network egress policy is the backstop for that.
  return parsed.toString();
}

export const EXEC_TIMEOUT_MS = 120_000;
export const CONTAINER_TIMEOUT_MS = 180_000;
export const MAX_OUTPUT_CHARS = 256_000;
