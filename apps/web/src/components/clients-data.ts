/**
 * Agent products that support the Agent Skills format, curated to the most
 * recognisable from the canonical showcase at agentskills.io/clients.
 * Logos are vendored under public/clients/ as `{slug}-light.{ext}` /
 * `{slug}-dark.{ext}` pairs, sourced from that showcase; each logo remains the
 * trademark of its owner and is used nominatively to state format support.
 *
 * `skillistOrg` marks a client whose source repo is mirrored into the registry
 * (a `skill_sources` row, orgs namespaced by GitHub owner). Only repos that
 * ship agentskills.io-format skills in a discovery root qualify, so most
 * clients never get one.
 */
export type ClientData = {
  name: string;
  slug: string;
  description: string;
  url: string;
  instructionsUrl?: string;
  sourceCodeUrl?: string;
  skillistOrg?: string;
  /** Logo file extension; the showcase ships a few raster-only logos. */
  ext: "svg" | "png";
  /** Optical width correction for logos whose lockups run unusually wide or tight. */
  scale?: number;
};

export const CLIENTS: ClientData[] = [
  {
    name: "Amp",
    slug: "amp",
    description: "Frontier coding agent built to wield the full power of leading models.",
    url: "https://ampcode.com/",
    instructionsUrl: "https://ampcode.com/manual#agent-skills",
    ext: "svg",
    scale: 0.8,
  },
  {
    name: "Claude",
    slug: "claude",
    description: "Anthropic's AI for problem solvers: analysis, writing, and code.",
    url: "https://claude.ai/",
    instructionsUrl: "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview",
    ext: "svg",
  },
  {
    name: "Claude Code",
    slug: "claude-code",
    description:
      "Agentic coding tool that reads your codebase, edits files, and runs commands in your terminal, IDE, and browser.",
    url: "https://claude.ai/code",
    instructionsUrl: "https://code.claude.com/docs/en/skills",
    ext: "svg",
  },
  {
    name: "Cursor",
    slug: "cursor",
    description: "AI editor and coding agent for understanding, building, and reviewing code.",
    url: "https://cursor.com/",
    instructionsUrl: "https://cursor.com/docs/context/skills",
    ext: "svg",
  },
  {
    name: "Databricks Genie Code",
    slug: "databricks",
    description: "Autonomous AI partner purpose-built for data work in Databricks.",
    url: "https://databricks.com/",
    instructionsUrl: "https://docs.databricks.com/aws/en/assistant/skills",
    ext: "svg",
  },
  {
    name: "Factory",
    slug: "factory",
    description:
      "AI-native development platform that delegates complete tasks to Droids, from IDE to CI/CD.",
    url: "https://factory.ai/",
    instructionsUrl: "https://docs.factory.ai/cli/configuration/skills",
    ext: "svg",
  },
  {
    name: "Gemini CLI",
    slug: "gemini-cli",
    description: "Open-source AI agent that brings Gemini directly into your terminal.",
    url: "https://geminicli.com",
    instructionsUrl: "https://geminicli.com/docs/cli/skills/",
    sourceCodeUrl: "https://github.com/google-gemini/gemini-cli",
    ext: "svg",
  },
  {
    name: "GitHub Copilot",
    slug: "github-copilot",
    description: "Works alongside you in your editor, suggesting lines and entire functions.",
    url: "https://github.com/",
    instructionsUrl: "https://docs.github.com/en/copilot/concepts/agents/about-agent-skills",
    sourceCodeUrl: "https://github.com/microsoft/vscode-copilot-chat",
    ext: "svg",
  },
  {
    name: "Google AI Edge Gallery",
    slug: "google-ai-edge-gallery",
    description: "Runs the most powerful open-source LLMs directly on your mobile device.",
    url: "https://github.com/google-ai-edge/gallery",
    instructionsUrl: "https://github.com/google-ai-edge/gallery/tree/main/skills",
    sourceCodeUrl: "https://github.com/google-ai-edge/gallery",
    // Its repo ships agentskills.io-format skills, so Skillist mirrors it:
    // the skill_sources row publishes into the google-ai-edge org.
    skillistOrg: "google-ai-edge",
    ext: "svg",
    scale: 0.9,
  },
  {
    name: "Goose",
    slug: "goose",
    description:
      "Open-source, extensible AI agent that installs, executes, edits, and tests with any LLM.",
    url: "https://block.github.io/goose/",
    instructionsUrl: "https://block.github.io/goose/docs/guides/context-engineering/using-skills/",
    sourceCodeUrl: "https://github.com/block/goose",
    ext: "png",
  },
  {
    name: "Junie",
    slug: "junie",
    description:
      "LLM-agnostic coding agent on the IntelliJ Platform; it understands your project the way your editor does.",
    url: "https://junie.jetbrains.com/",
    instructionsUrl: "https://junie.jetbrains.com/docs/agent-skills.html",
    ext: "svg",
  },
  {
    name: "Kiro",
    slug: "kiro",
    description: "Brings structure to AI coding with spec-driven development.",
    url: "https://kiro.dev/",
    instructionsUrl: "https://kiro.dev/docs/skills/",
    ext: "svg",
  },
  {
    name: "Letta",
    slug: "letta",
    description: "Platform for building stateful agents with advanced memory that learn over time.",
    url: "https://www.letta.com/",
    instructionsUrl: "https://docs.letta.com/letta-code/skills/",
    sourceCodeUrl: "https://github.com/letta-ai/letta",
    ext: "svg",
    scale: 2,
  },
  {
    name: "OpenAI Codex",
    slug: "openai-codex",
    description: "OpenAI's coding agent for software development.",
    url: "https://developers.openai.com/codex",
    instructionsUrl: "https://developers.openai.com/codex/skills/",
    sourceCodeUrl: "https://github.com/openai/codex",
    ext: "svg",
  },
  {
    name: "OpenCode",
    slug: "opencode",
    description: "Open-source agent that helps you write code in your terminal, IDE, or desktop.",
    url: "https://opencode.ai/",
    instructionsUrl: "https://opencode.ai/docs/skills/",
    sourceCodeUrl: "https://github.com/sst/opencode",
    ext: "svg",
  },
  {
    name: "OpenHands",
    slug: "openhands",
    description:
      "Open platform for cloud coding agents; scale from one to thousands, model-agnostic.",
    url: "https://openhands.dev/",
    instructionsUrl: "https://docs.openhands.dev/overview/skills",
    sourceCodeUrl: "https://github.com/OpenHands/OpenHands",
    ext: "svg",
  },
  {
    name: "Roo Code",
    slug: "roo-code",
    description:
      "An AI dev team in your editor, with project-wide context and multi-step agentic coding.",
    url: "https://roocode.com",
    instructionsUrl: "https://docs.roocode.com/features/skills",
    sourceCodeUrl: "https://github.com/RooCodeInc/Roo-Code",
    ext: "svg",
  },
  {
    name: "Snowflake Cortex Code",
    slug: "snowflake",
    description:
      "AI agent integrated into the Snowflake platform for data engineering, analytics, and ML.",
    url: "https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code",
    instructionsUrl:
      "https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#extensibility-skills",
    ext: "svg",
  },
  {
    name: "Spring AI",
    slug: "spring-ai",
    description: "Streamlines building AI functionality into Spring applications.",
    url: "https://docs.spring.io/spring-ai/reference",
    instructionsUrl: "https://spring.io/blog/2026/01/13/spring-ai-generic-agent-skills/",
    sourceCodeUrl: "https://github.com/spring-projects/spring-ai",
    ext: "svg",
  },
  {
    name: "TRAE",
    slug: "trae",
    description: "Adaptive AI IDE that collaborates with you to run faster.",
    url: "https://trae.ai/",
    instructionsUrl: "https://www.trae.ai/blog/trae_tutorial_0115",
    sourceCodeUrl: "https://github.com/bytedance/trae-agent",
    ext: "svg",
    scale: 1.7,
  },
  {
    name: "VS Code",
    slug: "vscode",
    description:
      "Combines the simplicity of a code editor with what developers need for the edit-build-debug cycle.",
    url: "https://code.visualstudio.com/",
    instructionsUrl: "https://code.visualstudio.com/docs/copilot/customization/agent-skills",
    sourceCodeUrl: "https://github.com/microsoft/vscode",
    ext: "svg",
  },
];
