import { z } from "zod";

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
