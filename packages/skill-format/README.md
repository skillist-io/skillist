# @skillist/skill-format

Parse, validate, and review [agentskills.io](https://agentskills.io) skill bundles.

This is the same validator [Skillist](https://skillist.io) runs at publish time, so a bundle that
passes here is one the registry will accept. Use it in CI to catch a malformed `SKILL.md` before it
reaches review, or to build your own tooling around the format.

## Install

```bash
npm install @skillist/skill-format
```

## Usage

A bundle is a `Map` of path → file contents. `SKILL.md` is required, and its frontmatter must carry
both `name` and `description`.

```ts
import { extractRegistryDiscovery, validateSkillBundle } from "@skillist/skill-format";

const bundle = new Map([
  [
    "SKILL.md",
    `---
name: my-skill
description: Audits a codebase and reports findings.
metadata:
  category: quality
  tags: audit, review
---
# My Skill

Instructions for the agent go here.`,
  ],
]);

// The second argument is the expected repo slug: `name` must match it.
const result = validateSkillBundle(bundle, "my-skill");

if (!result.valid) {
  console.error(result.errors); // [{ path, message }]
} else {
  // Takes the parsed frontmatter, not the raw markdown.
  const { category, tags } = extractRegistryDiscovery(result.frontmatter);
  console.log(category); // "quality"
  // `tags` is the full searchable set, so `category` and `level` appear in it too.
  console.log(tags); // ["quality", "audit", "review"]
}
```

## Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Lowercase alphanumeric + hyphens, 1–64 chars. No leading, trailing, or consecutive hyphens. Must equal the repo slug. |
| `description` | yes | 1–1024 chars. Shown in registry listings and used for discovery. |
| `license` | no | SPDX identifier. |
| `compatibility` | no | Free text, ≤500 chars. |
| `metadata` | no | String map. `category`, `level`, and `tags` drive registry discovery. |
| `allowed-tools` | no | Restricts the tools an agent may use with this skill. |

## Bundle layout

```
SKILL.md        required — instructions + frontmatter
plugin.json     optional — runtime, agent compatibility, MCP servers
scripts/        optional — executable scripts
references/     optional — supporting documents
assets/         optional — binary assets, base64-encoded
```

Paths containing `..`, absolute paths, and drive letters are rejected. Binary assets must live under
`assets/` and stay within the per-file size limit.

### `plugin.json` — `network.allowedHosts`

Hosted skill execution runs in a **deny-by-default** network sandbox: only a baseline of package
registries and source hosts is reachable. A skill that needs to reach other hosts declares them so its
runs are widened to `baseline + declared` (least privilege, and visible for review):

```json
{
  "name": "deploy-audit",
  "network": { "allowedHosts": ["api.stripe.com", "*.example.com"] }
}
```

Entries must be a concrete host or a specific wildcard. Catch-all and TLD-wide patterns (`*`, `*.*`,
`*.com`) are rejected at validation — a skill cannot self-grant unrestricted egress — and internal /
link-local ranges stay blocked regardless. Declared hosts appear in the security scan as a low-severity
review signal.

## API

| Export | Purpose |
| --- | --- |
| `validateSkillBundle(bundle, expectedSlug?)` | Full bundle validation. Returns `{ valid, frontmatter, errors }`. |
| `parseSkillMd(source)` | Split `SKILL.md` into frontmatter + body. |
| `serializeSkillMd(frontmatter, body)` | Inverse of `parseSkillMd`. |
| `updateSkillMdFrontmatter(source, patch)` | Edit frontmatter, preserving the body. |
| `validateSkillName(name)` | Check a slug in isolation. |
| `createSkillTemplate(name)` | Scaffold a minimal valid bundle. |
| `extractRegistryDiscovery(frontmatter)` | Pull `category` and `tags`. |
| `extractAgentDiscovery(pluginManifest)` | Pull compatible agents from `plugin.json`. |
| `bundleToObject` / `objectToBundle` | Convert between `Map` and plain object. |
| `skillFrontmatterSchema` | The Zod schema, for your own validation. |

## Documentation

Format reference and platform docs: [docs.skillist.io](https://docs.skillist.io)

## License

MIT
