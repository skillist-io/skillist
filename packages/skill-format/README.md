# @skillist/skill-format

Validation and review utilities for [agentskills.io](https://agentskills.io) skill bundles on [Skillist](https://skillist.dev).

## Install

```bash
npm install @skillist/skill-format
```

## Usage

```ts
import { validateSkillBundle, extractRegistryDiscovery } from "@skillist/skill-format";

const bundle = new Map([
  ["SKILL.md", "---\nname: my-skill\n---\n# My Skill"],
]);

const result = validateSkillBundle(bundle, "my-skill");
if (!result.valid) {
  console.error(result.errors);
}

const { category, tags } = extractRegistryDiscovery(bundle.get("SKILL.md") ?? "");
```

## License

MIT
