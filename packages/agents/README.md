# @skillist/agents

Load [Skillist](https://skillist.dev) skills into [Cloudflare Agents](https://developers.cloudflare.com/agents/skills/).

`skillist()` returns a `SkillSource` for the Agents SDK's `agents/skills` API. It is used the same way as the built-in `workspace()`, `r2()` and `manifest()` sources, but reads skills from the Skillist registry. Publish a new version on Skillist, and the agent uses it on its next turn without a redeploy.

> Cloudflare's Agent Skills API is experimental. This package targets `agents` 0.33.x.

## Install

```sh
npm install @skillist/agents agents
```

## Use with Think

```ts
import { Think } from "@cloudflare/think";
import { skillist } from "@skillist/agents";

export class ReleaseAgent extends Think<Env> {
  // Build the source once, as a field. It caches each bundle and revalidates
  // it with an ETag, which only works if the same object lives across turns.
  #skills = skillist({
    skills: [
      "acme/release-notes", // latest published version, rechecked every turn
      "acme/pdf-tools@1.2.0", // pinned: fetched once, never rechecked
    ],
  });

  getSkills() {
    return [this.#skills];
  }
}
```

## Use without Think

```ts
import { loadSkillCatalog } from "agents/skills";
import { createSkillTools } from "agents/skills/tools/ai-sdk";
import { skillist } from "@skillist/agents";

const source = skillist({ skills: ["acme/release-notes"] });

const catalog = await loadSkillCatalog([source]);
const result = streamText({
  model,
  system: [basePrompt, catalog.prompt()].filter(Boolean).join("\n\n"),
  tools: createSkillTools(catalog),
  messages,
});
```

## How it stays fresh

Each `list()` sends one conditional `GET /{org}/{repo}/bundle` per unpinned ref, with the ETag from the last response. The ETag is the published version id:

- **Unchanged:** the server answers `304`. That costs one KV read and no transfer.
- **New version:** the full bundle comes back and replaces the cached one.
- **`404`:** the skill is missing, private, or retracted, and it is dropped right away. A cached copy is never kept, because a retraction has to stop delivery.
- **Network error or `5xx`:** the last good copy keeps being served. If every ref fails and nothing is cached, `list()` returns a `SkillSourceError`. The SDK's catalog then keeps the source's previous listing and logs why.

`readResource()` reads from the bundle fetched during the last `list()`. A file the model reads always comes from the version it was shown, even if a newer version was published since.

## Options

| Option              | Default                  | Meaning                                                    |
| ------------------- | ------------------------ | ---------------------------------------------------------- |
| `skills`            | required                 | `org/repo` or `org/repo@1.2.3`. If two refs share a skill name, the first one wins. |
| `baseUrl`           | `https://skillist.dev`   | Delivery origin.                                           |
| `refreshIntervalMs` | `0`                      | Minimum time between revalidations. `0` checks on every turn. |
| `id`                | `skillist:<host>`        | Source id shown in the SDK's diagnostics.                  |
| `fetch`             | global `fetch`           | Custom transport, for example in tests.                    |
| `onWarning`         | `console.warn`           | Called once per state change for each ref: missing, failing, or duplicate. |

## Limits

- **Public skills only.** This package uses Skillist's unauthenticated delivery API. Private and org-only skills return `404` and are skipped.
- **Scripts.** Skillist scripts are command-line programs (`node`, `bash` or `python3` with arguments). The SDK's experimental `skills.runner()` instead expects a default-export function for JavaScript and `/input.json` for Python and Bash. So most Skillist scripts won't run under `runner()` without changes. To run them as written, use a Computer Workspace with a shell, or Skillist's hosted execution.

## License

MIT
