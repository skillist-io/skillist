import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import {
  base64DecodedSize,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
} from "./binary.js";
import type { PluginManifest } from "./plugin.js";

const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const skillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(SKILL_NAME_REGEX, "name must be lowercase alphanumeric with hyphens"),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export type SkillBundle = Map<string, string>;

export type ValidationError = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { valid: true; frontmatter: SkillFrontmatter; body: string }
  | { valid: false; errors: ValidationError[] };

const OPTIONAL_DIRS = ["scripts", "references", "assets"] as const;
const ALLOWED_ROOT_FILES = ["plugin.json"] as const;

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseFrontmatter(content: string): {
  frontmatter: unknown;
  body: string;
} | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;
  try {
    const frontmatter = parseYaml(match[1]!);
    return { frontmatter, body: match[2] ?? "" };
  } catch {
    return null;
  }
}

export function parseSkillMd(content: string): {
  yamlText: string;
  frontmatter: unknown;
  body: string;
} | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;
  try {
    return {
      yamlText: match[1]!,
      frontmatter: parseYaml(match[1]!),
      body: match[2] ?? "",
    };
  } catch {
    return null;
  }
}

const FRONTMATTER_KEY_ORDER = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;

function stringifyFrontmatter(frontmatter: SkillFrontmatter): string {
  const ordered: Record<string, unknown> = {};
  for (const key of FRONTMATTER_KEY_ORDER) {
    const value = frontmatter[key as keyof SkillFrontmatter];
    if (value !== undefined) ordered[key] = value;
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered) && value !== undefined) ordered[key] = value;
  }
  // lineWidth: 0 disables folding — a long description stays one line
  // instead of yaml wrapping it, which would otherwise reformat text the
  // author didn't touch every time any other field changes.
  return stringifyYaml(ordered, { lineWidth: 0 }).trimEnd();
}

export function serializeSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  return `---\n${stringifyFrontmatter(frontmatter)}\n---\n${body}`;
}

/**
 * Replaces only the YAML between the frontmatter fences, leaving the body
 * byte-identical. Comments and custom key order inside the YAML block are
 * not preserved — the block is regenerated from the given frontmatter.
 */
export function updateSkillMdFrontmatter(content: string, frontmatter: SkillFrontmatter): string {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return serializeSkillMd(frontmatter, content);
  return `---\n${stringifyFrontmatter(frontmatter)}\n---\n${match[2] ?? ""}`;
}

export function validateSkillName(name: string, slug?: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (name.length < 1 || name.length > 64) {
    errors.push({ path: "name", message: "name must be 1-64 characters" });
  }
  if (!SKILL_NAME_REGEX.test(name)) {
    errors.push({
      path: "name",
      message:
        "name may only contain lowercase letters, numbers, and hyphens; no leading/trailing/consecutive hyphens",
    });
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    errors.push({
      path: "name",
      message: "name must not start/end with hyphen or contain consecutive hyphens",
    });
  }
  if (slug && name !== slug) {
    errors.push({
      path: "name",
      message: `name must match skill slug "${slug}"`,
    });
  }
  return errors;
}

export function validateSkillBundle(files: SkillBundle, expectedSlug?: string): ValidationResult {
  const errors: ValidationError[] = [];

  const skillMd = files.get("SKILL.md");
  if (!skillMd) {
    return {
      valid: false,
      errors: [{ path: "SKILL.md", message: "SKILL.md is required" }],
    };
  }

  const parsed = parseFrontmatter(skillMd);
  if (!parsed) {
    return {
      valid: false,
      errors: [
        {
          path: "SKILL.md",
          message: "SKILL.md must contain YAML frontmatter delimited by ---",
        },
      ],
    };
  }

  const fmResult = skillFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!fmResult.success) {
    for (const issue of fmResult.error.issues) {
      errors.push({
        path: `frontmatter.${issue.path.join(".")}`,
        message: issue.message,
      });
    }
  }

  const name = fmResult.success ? fmResult.data.name : "";
  errors.push(...validateSkillName(name, expectedSlug));

  for (const [filePath, content] of files.entries()) {
    if (filePath === "SKILL.md") continue;
    if (isBinaryAssetPath(filePath) && !filePath.startsWith("assets/")) {
      errors.push({
        path: filePath,
        message: "binary assets (images, PDFs, archives) must live under assets/",
      });
    }
    // Reject path traversal / absolute paths outright — do NOT fold this into
    // the allowed-root skip. At runtime every bundle entry is written to
    // `/workspace/${path}`, so a `..` segment or leading slash escapes the
    // sandbox workspace and can clobber runtime files. These must fail
    // validation, not be silently skipped.
    if (
      filePath.includes("..") ||
      filePath.startsWith("/") ||
      filePath.startsWith("\\") ||
      filePath.includes("\0") ||
      /^[a-zA-Z]:/.test(filePath)
    ) {
      errors.push({
        path: filePath,
        message: "file path must be relative and must not contain '..' or a leading slash",
      });
      continue;
    }
    if ((ALLOWED_ROOT_FILES as readonly string[]).includes(filePath)) {
      continue;
    }
    const topDir = filePath.split("/")[0];
    if (
      topDir &&
      !OPTIONAL_DIRS.includes(topDir as (typeof OPTIONAL_DIRS)[number]) &&
      !filePath.includes("/")
    ) {
      if (!OPTIONAL_DIRS.some((d) => filePath.startsWith(`${d}/`))) {
        errors.push({
          path: filePath,
          message: `unexpected file path; use scripts/, references/, or assets/`,
        });
      }
    }
    if (filePath.startsWith("assets/") && isBinaryAssetPath(filePath)) {
      if (!isValidBase64(content)) {
        errors.push({ path: filePath, message: "binary asset content must be valid base64" });
      } else if (base64DecodedSize(content) > MAX_BINARY_ASSET_BYTES) {
        errors.push({
          path: filePath,
          message: `binary asset exceeds the ${MAX_BINARY_ASSET_BYTES / (1024 * 1024)}MB limit`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    frontmatter: fmResult.data!,
    body: parsed.body,
  };
}

export function createSkillTemplate(slug: string, description: string): SkillBundle {
  const bundle = new Map<string, string>();
  // Goes through the proper YAML serializer rather than raw interpolation —
  // an unquoted description containing ": " (e.g. an auto-generated
  // "Agent skill: <name>" default) would otherwise produce invalid
  // frontmatter that fails the bundle's own validation.
  bundle.set(
    "SKILL.md",
    serializeSkillMd({ name: slug, description }, `\n# ${slug}\n\nAdd skill instructions here.\n`),
  );
  return bundle;
}

export function bundleToObject(bundle: SkillBundle): Record<string, string> {
  return Object.fromEntries(bundle);
}

export function objectToBundle(files: Record<string, string>): SkillBundle {
  return new Map(Object.entries(files));
}

export function extractDiscoveryMeta(
  bundle: SkillBundle,
): { name: string; description: string } | null {
  const result = validateSkillBundle(bundle);
  if (!result.valid) return null;
  return {
    name: result.frontmatter.name,
    description: result.frontmatter.description,
  };
}

export function extractRegistryDiscovery(frontmatter: SkillFrontmatter): {
  category: string | null;
  tags: string[];
} {
  const metadata = frontmatter.metadata ?? {};
  const tags = new Set<string>();

  if (metadata.category) tags.add(metadata.category.trim().toLowerCase());
  if (metadata.level) tags.add(metadata.level.trim().toLowerCase());
  if (metadata.tags) {
    for (const part of metadata.tags.split(/[,;]/)) {
      const tag = part.trim().toLowerCase();
      if (tag) tags.add(tag);
    }
  }

  return {
    category: metadata.category?.trim().toLowerCase() ?? null,
    tags: [...tags],
  };
}

const KNOWN_AGENTS = new Set([
  "cursor",
  "claude",
  "vscode",
  "windsurf",
  "cline",
  "copilot",
  "generic",
]);

export function extractAgentDiscovery(manifest: PluginManifest | null | undefined): string[] {
  if (!manifest) return [];
  const agents = new Set<string>();
  for (const agent of manifest.agents ?? []) {
    const normalized = agent.trim().toLowerCase();
    if (normalized) agents.add(normalized);
  }
  if (manifest.mcp?.servers?.length) {
    agents.add("mcp");
  }
  return [...agents].filter((a) => KNOWN_AGENTS.has(a) || a.length > 1);
}

export {
  BINARY_ASSET_EXTENSIONS,
  base64DecodedSize,
  binaryAssetMimeType,
  decodeBase64,
  encodeBase64,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
} from "./binary.js";
export {
  isAllowedHostPattern,
  type PluginManifest,
  parsePluginManifest,
  pluginManifestSchema,
} from "./plugin.js";
export {
  estimateImpactScore,
  type ReviewCheck,
  type ReviewRubricConfig,
  reviewSkillBundle,
  type SkillReviewResult,
} from "./review.js";
export {
  runSecurityScan,
  type SecurityIssue,
  type SecurityScanResult,
  type SecurityScorer,
  scanSkillSecurity,
  setSecurityScorer,
} from "./security.js";
export {
  bumpSemver,
  compareSemver,
  resolveNextSemver,
  type SemverBump,
} from "./semver.js";
