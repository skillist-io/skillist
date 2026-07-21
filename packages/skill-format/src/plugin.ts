import { z } from "zod";

/**
 * A single leftmost-wildcard host label, then two or more dot-separated labels.
 * Accepts `api.stripe.com`, `*.example.com`, `*.githubusercontent.com`; rejects
 * catch-alls (`*`, `*.*`) and TLD-wide wildcards (`*.com`), which would let a
 * skill self-grant effectively unrestricted egress and defeat deny-by-default.
 */
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * True when `host` is a safe per-skill egress allowlist entry: a concrete
 * hostname or a specific-enough wildcard. Used both to validate the manifest at
 * publish time and to re-filter declared hosts before applying them at run time.
 */
export function isAllowedHostPattern(host: string): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  if (h.length === 0 || h.length > 253) return false;
  return HOST_PATTERN.test(h);
}

export const pluginManifestSchema = z.object({
  name: z.string().min(1).max(128),
  version: z.string().optional(),
  description: z.string().optional(),
  skills: z.array(z.string()).default(["SKILL.md"]),
  agents: z.array(z.string().min(1).max(64)).optional(),
  rules: z.array(z.string()).optional(),
  mcp: z
    .object({
      servers: z
        .array(
          z.object({
            name: z.string(),
            command: z.string().optional(),
            url: z.string().url().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  // Per-skill outbound network allowlist. These hosts are added to the sandbox's
  // baseline allowlist for the skill's runs (see apps/api lib/sandbox-egress).
  // Rejecting catch-all/TLD-wide patterns here is what keeps a skill from
  // self-granting unrestricted egress; internal ranges stay denied regardless.
  network: z
    .object({
      allowedHosts: z
        .array(
          z.string().refine(isAllowedHostPattern, {
            message:
              "must be a concrete host or specific wildcard (e.g. api.example.com or *.example.com); catch-all and TLD-wide patterns are not allowed",
          }),
        )
        .max(50)
        .optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parsePluginManifest(raw: string): PluginManifest | null {
  try {
    const parsed = JSON.parse(raw);
    const result = pluginManifestSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
