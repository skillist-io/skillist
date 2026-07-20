import { createAnthropic } from "@ai-sdk/anthropic";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { registryQuerySchema } from "@skillist/contracts";
import {
  agentChats,
  feedback,
  orgRequiredSkills,
  registryEntries,
  skillEvals,
  skillFailurePatterns,
  skills,
} from "@skillist/db/schema";
import { callable } from "agents";
import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
  type UIMessage,
  wrapLanguageModel,
} from "ai";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { Env } from "../env";
import { requireApproval } from "../lib/agent/approvals";
import { buildMemoryBlock, forgetFact, rememberFact, searchMemory } from "../lib/agent/memory";
import { logAudit } from "../lib/audit";
import { computeCoverage } from "../lib/coverage";
import { createWorkerDb, type WorkerDb } from "../lib/db";
import { searchDocs } from "../lib/docs-rag";
import { getRegistryFacets, getRegistrySkill, listRegistry } from "../lib/registry-service";
import { validateSkillMd } from "../lib/skill-validation";
import { parseAgentName, shouldGenerateTitle } from "./agent-name";
import { workersAiFallback } from "./model-fallback";

/**
 * The agent prefers Claude — small Workers AI models narrate tool calls instead
 * of invoking them, which breaks the governance toolset. Claude is used when
 * ANTHROPIC_API_KEY is configured (routed through the Cloudflare AI Gateway when
 * AI_GATEWAY_ACCOUNT_ID is set, for caching + observability), and we fall back
 * to a tool-capable Workers AI model so the agent still runs without the secret.
 */
const CLAUDE_MODEL_ID = "claude-sonnet-5";
const WORKERS_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

/** Evals older than this (or never run) count as stale. */
const STALE_EVAL_DAYS = 30;

/** Storage cap on persisted history per chat (bounds SQLite growth). */
const MAX_PERSISTED_MESSAGES = 200;

/** How many regenerated variants to keep per user message. */
const MAX_VARIANTS_PER_MESSAGE = 5;

const SYSTEM_PROMPT = [
  "You are the Skillist platform agent. Skillist (skillist.io) is a realtime Agent Skills",
  "registry — teams publish, version, improve, and deliver skills that comply with the",
  "agentskills.io spec. You are a knowledgeable assistant for the WHOLE platform AND the",
  "spec: help users both USE Skillist and AUTHOR compliant skills.",
  "",
  "Be precise, technical, and calm — engineering-grade restraint. Never invent skills,",
  "numbers, endpoints, or spec rules. When a question is answerable from data, docs, the",
  "registry, or a validation, CALL A TOOL rather than guessing; if no tool covers it, say so",
  "plainly.",
  "",
  "== Skillist platform (what you can speak to) ==",
  "• Registry & discovery: a public, searchable index of skills with quality/impact/security",
  "  scores, stars, installs, categories, tags, and compatible agents; native skills plus",
  "  mirrored GitHub sources. Use search_registry / get_skill / registry_facets.",
  "• Publishing & versioning: skills are published as immutable semver versions; publish runs",
  "  validation, a review rubric, a security scan, and (per org policy) evals before going live.",
  "• Curation: projects group skills (and external references) into curated collections.",
  "• Governance: an org declares required skills (its baseline) and tracks coverage across three",
  "  layers — published (in registry) → covered (in scanned inventory or curated) → activated",
  "  (agents turned it on) — plus drift (required but not covered). Use get_coverage.",
  "• Evals: skills are scored for uplift; stale/failed evals are flagged for re-run.",
  "• Hosted execution: skill scripts run in Cloudflare Sandbox containers (local/sandbox/",
  "  container runtimes; heavy skills get a heavier sandbox), gated by quotas and access.",
  "• Delivery: published SKILL.md + meta are served from a KV edge hot path (<10ms); full",
  "  bundles live in R2; versions are immutable and edge-cached.",
  "• MCP server: a remote MCP endpoint (/mcp) exposes registry + project tools to agents.",
  "• Feedback → AI-improvement loop: human or agent feedback, once approved, drafts an improved",
  "  SKILL.md version; recurring execution/eval failures are mined into feedback automatically.",
  "",
  "== agentskills.io spec (for authoring) ==",
  "A skill is a FOLDER containing a SKILL.md with YAML frontmatter:",
  "  - name: ≤64 chars, lowercase alphanumeric + hyphens (matches the repo slug).",
  "  - description: non-empty, ≤1024 chars, saying WHAT the skill does AND WHEN to use it.",
  "Optional sibling dirs: scripts/ (executable), references/ (docs the agent can read),",
  "assets/ (binary files — images/PDFs/archives live here, base64). Progressive disclosure has",
  "three stages: discovery (name+description surfaced) → activation (SKILL.md body loaded) →",
  "execution (scripts/references pulled in as needed). To check an authored SKILL.md against the",
  "spec + security, call validate_skill and report the exact errors/issues.",
  "",
  "== Claude Agent Skills across surfaces ==",
  "Skills install differently per surface: Claude Code reads personal skills from",
  "~/.claude/skills/ and project skills from .claude/skills/; the Claude API uploads a skill",
  "workspace-wide; claude.ai takes a per-user skill zip. Skillist's CLI/registry is the source",
  "these pull from.",
  "",
  "For platform how-tos (endpoints, publishing steps, coverage semantics, delivery internals),",
  "call search_docs to ground the answer in Skillist's own documentation and cite the page.",
  "",
  // The console attaches where the user is standing so that deictic questions
  // ("what's drifting here?") resolve. It says what they are looking at, never
  // what the values are — those still come from tools.
  'A user message may begin with a "[context] page: …, path: …" line describing the',
  "console screen the user is looking at. Use it to resolve references like",
  '"this skill" or "here", and to prefer the matching tool. It never carries live',
  "values — always call a tool for numbers. Do not mention the context line itself.",
].join("\n");

/**
 * Prepended to the system prompt (after any known-facts block). Tells the agent
 * when to persist a durable governance fact into memory — and, just as
 * importantly, when NOT to.
 */
const MEMORY_PROTOCOL = [
  "== Memory protocol ==",
  "You have a durable memory for this org. When the user states a DURABLE governance",
  "fact — an org policy (e.g. 'we require a security pass on every skill'), a skill's known",
  "quirk, a naming/versioning convention, an approval rule — call the `remember` tool with a",
  "stable, descriptive key (e.g. 'policy:security-pass', 'convention:skill-naming') and a",
  "concise value. Prefer org scope for governance facts. Update the same key rather than",
  "inventing near-duplicates; use `search_memory` first when unsure. Do NOT remember ephemeral",
  "context (the current question, one-off values, anything you just fetched from a tool). PII in",
  "a value is auto-redacted before it is stored — if the tool reports redactions, tell the user.",
].join("\n");

/** One regenerated assistant reply snapshot, keyed under its user message. */
type AssistantVariant = { id: string; parts: unknown[]; createdAt: number };

type SkillistAgentState = {
  orgId: string | null;
  userId: string | null;
  chatId: string | null;
  title: string | null;
  /** Regenerated assistant replies, keyed by the (stable) user message id. */
  variants?: Record<string, AssistantVariant[]>;
};

export class SkillistAgent extends AIChatAgent<Env, SkillistAgentState> {
  initialState: SkillistAgentState = {
    orgId: null,
    userId: null,
    chatId: null,
    title: null,
  };

  /**
   * Bound persisted-history growth. Storage-only — does not change what is sent
   * to the model (that is the full `this.messages` on each turn).
   */
  maxPersistedMessages = MAX_PERSISTED_MESSAGES;

  /**
   * Identity comes from the composite DO instance name `orgId::userId::chatId`
   * (the gate in src/index.ts rewrites the client's `orgId::chatId` to inject
   * the session-verified userId). Promoted to durable state in `onConnect` so
   * tools + persistence keep the identity after hibernation even when onConnect
   * has not re-fired. Tools scope every read by `orgId()`.
   */
  private orgId(): string | null {
    return this.state?.orgId ?? parseAgentName(this.name).orgId ?? null;
  }

  private userId(): string | null {
    return this.state?.userId ?? parseAgentName(this.name).userId ?? null;
  }

  private chatId(): string | null {
    return this.state?.chatId ?? parseAgentName(this.name).chatId ?? null;
  }

  async onConnect(
    ...args: Parameters<AIChatAgent<Env, SkillistAgentState>["onConnect"]>
  ): Promise<void> {
    // Parse the composite instance name into durable state. userId here is the
    // session-verified value the gate baked into the name — the client can't
    // spoof it because it never appears in the URL the browser controls.
    const { orgId, userId, chatId } = parseAgentName(this.name);
    if (
      (orgId && this.state?.orgId !== orgId) ||
      (userId && this.state?.userId !== userId) ||
      (chatId && this.state?.chatId !== chatId)
    ) {
      this.setState({
        ...(this.state ?? this.initialState),
        orgId: orgId || this.state?.orgId || null,
        userId: userId || this.state?.userId || null,
        chatId: chatId || this.state?.chatId || null,
      });
    }
    return super.onConnect(...args);
  }

  /**
   * Build the language model for a turn. Prefers Claude for reliable
   * tool-calling (routed through the AI Gateway when configured for caching +
   * observability); falls back to a tool-capable Workers AI model so the agent
   * still runs without the Anthropic secret. Reused for title generation.
   */
  private buildModel() {
    // sessionAffinity pins this DO's turns to one Workers AI replica.
    const workers = createWorkersAI({ binding: this.env.AI })(WORKERS_MODEL_ID, {
      sessionAffinity: this.sessionAffinity,
    });
    // No Anthropic secret → run on Workers AI directly.
    if (!this.env.ANTHROPIC_API_KEY) return workers;

    const claude = createAnthropic({
      apiKey: this.env.ANTHROPIC_API_KEY,
      ...(this.env.AI_GATEWAY_ACCOUNT_ID
        ? {
            baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ACCOUNT_ID}/skillist/anthropic`,
            headers: this.env.AI_GATEWAY_TOKEN
              ? { "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}` }
              : undefined,
          }
        : {}),
    })(CLAUDE_MODEL_ID);

    // Claude for reliable tool-calling, but if its call FAILS TO START (a
    // bad/expired key, provider 4xx/5xx, gateway outage) fall back to Workers AI
    // for that turn instead of failing the whole agent. A single bad credential
    // used to take the agent fully down with no server-side log; now it degrades.
    return wrapLanguageModel({ model: claude, middleware: workersAiFallback(workers) });
  }

  /**
   * Upsert this chat's row in `agent_chats` — the per-user index the console
   * sidebar lists from (the DO owns the messages; this row is just metadata so
   * the list survives reloads and works across browsers). Called on every user
   * turn (refreshes `updated_at` for newest-first ordering) and again when the
   * auto-title lands. COALESCE keeps a null title from wiping an existing one,
   * and the conflict is constrained to `userId = self` so a chatId collision
   * can never let one user clobber another's row. Skips when identity is
   * incomplete (e.g. a legacy connect with no chatId). Best-effort.
   */
  private async persistChatRow(title: string | null): Promise<void> {
    const orgId = this.orgId();
    const userId = this.userId();
    const chatId = this.chatId();
    if (!orgId || !userId || !chatId) return;
    try {
      const db = createWorkerDb(this.env);
      const now = new Date();
      await db
        .insert(agentChats)
        .values({ id: chatId, orgId, userId, title, updatedAt: now })
        .onConflictDoUpdate({
          target: agentChats.id,
          set: {
            title: sql`COALESCE(${title}, ${agentChats.title})`,
            updatedAt: now,
          },
          where: eq(agentChats.userId, userId),
        });
    } catch (err) {
      console.warn("persistChatRow failed", err);
    }
  }

  async onChatMessage() {
    const orgId = this.orgId();
    const userId = this.userId();
    const db = createWorkerDb(this.env);
    const tools = this.buildTools(db, orgId, userId);

    // Snapshot before streaming: is this the first assistant turn (so we should
    // generate a title once it finishes)?
    const userTurns = (this.messages as UIMessage[]).filter((m) => m.role === "user").length;
    const firstTurn = shouldGenerateTitle(userTurns, Boolean(this.state?.title));

    // Refresh the chat-index row on every turn so sidebar ordering stays
    // accurate. Title stays as-is here; generateTitle fills it in below.
    void this.persistChatRow(this.state?.title ?? null);

    // Pull the org's durable governance memory into the system prompt so the
    // agent carries known facts across conversations. Empty string when there
    // are none, so `.filter(Boolean)` drops it.
    const memoryBlock = await buildMemoryBlock(db, orgId, userId);
    const system = [memoryBlock, MEMORY_PROTOCOL, SYSTEM_PROMPT].filter(Boolean).join("\n\n");

    const result = streamText({
      model: this.buildModel(),
      system,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      // Surface a provider/stream failure server-side. Without this the error is
      // invisible in `wrangler tail` (the client just shows "hit an error"),
      // which is exactly what made the invalid-key outage hard to diagnose.
      onError: ({ error }) => {
        console.error(
          JSON.stringify({
            msg: "agent_stream_error",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      },
      onFinish: () => {
        if (firstTurn) {
          this.generateTitle().catch((err) => {
            console.warn("title generation failed", err);
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  }

  /**
   * Summarize the first user message + assistant reply into a short sidebar
   * title. Pushes the result via `setState` (subscribed clients update live)
   * and persists it so a later list picks it up. Best-effort — a failure here
   * never breaks the chat.
   */
  private async generateTitle(): Promise<void> {
    const msgs = this.messages as UIMessage[];
    const firstUser = msgs.find((m) => m.role === "user");
    if (!firstUser) return;
    const firstAssistant = msgs.find((m) => m.role === "assistant");
    const userText = extractText(firstUser).slice(0, 500);
    const assistantText = firstAssistant ? extractText(firstAssistant).slice(0, 300) : "";

    const { text } = await generateText({
      model: this.buildModel(),
      maxOutputTokens: 30,
      system:
        "You generate concise chat titles. Output 3 to 6 words, no quotes, no trailing punctuation. Title-case the result.",
      prompt: [
        `USER: ${userText}`,
        assistantText ? `ASSISTANT: ${assistantText}` : "",
        "",
        "Title:",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const title = text
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 80);
    if (!title) return;
    this.setState({ ...(this.state ?? this.initialState), title });
    void this.persistChatRow(title);
  }

  /**
   * Regenerate the assistant reply that follows a given user message.
   *
   * 1. Snapshot the current assistant reply into `state.variants[userMessageId]`
   *    so the user can cycle back to it.
   * 2. Truncate history to just before that reply and `saveMessages(truncated)`,
   *    which re-runs the same streaming turn.
   * 3. Snapshot the fresh reply as another variant.
   *
   * Keyed by the USER message id because it stays stable across regenerations
   * (each regenerate mints a new assistant id). Registered as a client-callable
   * RPC at the bottom of this file.
   */
  async regenerateMessage(userMessageId: string) {
    const messages = this.messages as UIMessage[];
    const userIdx = messages.findIndex((m) => m.id === userMessageId && m.role === "user");
    if (userIdx === -1) return { ok: false as const, reason: "user_message_not_found" as const };

    const assistantIdx = userIdx + 1;
    const currentAssistant = messages[assistantIdx];
    if (currentAssistant?.role !== "assistant") {
      return { ok: false as const, reason: "no_assistant_response" as const };
    }

    const baseState = this.state ?? this.initialState;
    const existingVariants = { ...(baseState.variants ?? {}) };
    const current = existingVariants[userMessageId] ?? [];

    // Snapshot the existing reply BEFORE truncating so it stays cyclable.
    const snapshot: AssistantVariant = {
      id: currentAssistant.id,
      parts: (currentAssistant.parts ?? []) as unknown[],
      createdAt: Date.now(),
    };
    existingVariants[userMessageId] = dedupeVariants([...current, snapshot]).slice(
      -MAX_VARIANTS_PER_MESSAGE,
    );
    this.setState({ ...baseState, variants: existingVariants });

    // Drop the assistant reply (and anything after it), then re-run. saveMessages
    // awaits the whole stream, so this.messages holds the new reply on resolve.
    const truncated = messages.slice(0, assistantIdx);
    await this.saveMessages(truncated);

    const afterMessages = this.messages as UIMessage[];
    const newAssistant = afterMessages[assistantIdx];
    if (newAssistant?.role === "assistant") {
      const afterState = this.state ?? this.initialState;
      const v = { ...(afterState.variants ?? {}) };
      const newSnapshot: AssistantVariant = {
        id: newAssistant.id,
        parts: (newAssistant.parts ?? []) as unknown[],
        createdAt: Date.now(),
      };
      v[userMessageId] = dedupeVariants([...(v[userMessageId] ?? []), newSnapshot]).slice(
        -MAX_VARIANTS_PER_MESSAGE,
      );
      this.setState({ ...afterState, variants: v });
    }

    return { ok: true as const };
  }

  /**
   * Wipe this chat's messages and reset state. Invoked over DO RPC from the
   * DELETE /agent/chats/{chatId} route after the row is removed, so a deleted
   * conversation leaves no persisted history behind.
   */
  async cleanup(): Promise<void> {
    await this.persistMessages([]);
    this.setState({ ...this.initialState });
  }

  /**
   * Governance toolset, all scoped to the DO's orgId. Every tool is read-only
   * except `draft_improvement`, which opens an agent-sourced feedback row for a
   * human to approve. When the instance has no orgId (should not happen behind
   * the Worker gate) tools fail closed rather than reading across orgs.
   */
  private buildTools(db: WorkerDb, orgId: string | null, initiatedBy: string | null): ToolSet {
    // Single-Promise return (not a union of Promises) so the AI SDK can infer
    // each tool's OUTPUT and resolve the `tool()` overload.
    const requireOrg = async <T>(
      fn: (orgId: string) => Promise<T>,
    ): Promise<T | { ok: false; reason: "no_org_scope" }> => {
      if (!orgId) return { ok: false as const, reason: "no_org_scope" as const };
      return fn(orgId);
    };

    const tools: ToolSet = {
      // ── Platform-wide tools (not org-scoped) ────────────────────────────────
      search_registry: tool({
        description:
          "Search the PUBLIC Skillist registry for skills anyone can install. Filter by free-text query, category, or tag. Returns matching skills with org/repo, name, description, quality score, stars, and install count. Use for 'is there a skill for X?', 'find a PDF skill', discovery.",
        inputSchema: z.object({
          query: z.string().optional().describe("Free-text search over name/description/repo."),
          category: z.string().optional().describe("Filter by category slug."),
          tag: z.string().optional().describe("Filter by tag."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Max results (default 10, max 20)."),
        }),
        execute: async ({ query, category, tag, limit }) => {
          const q = registryQuerySchema.parse({
            q: query,
            category,
            tag,
            limit: Math.min(limit ?? 10, 20),
          });
          const { items, total } = await listRegistry(db, q);
          return {
            ok: true as const,
            total,
            results: items.map((i) => ({
              skill: `${i.orgSlug}/${i.skillRepo}`,
              name: i.name,
              description: i.description,
              qualityScore: i.qualityScore,
              stars: i.stars,
              installCount: i.installCount,
              installCommand: i.installCommand,
            })),
          };
        },
      }),

      get_skill: tool({
        description:
          "Full registry detail for one public skill by org + repo: description, latest version, quality/impact/security, eval uplift, plugin manifest, and install/run commands. Use after search_registry, or when the user names a specific skill.",
        inputSchema: z.object({
          org: z.string().describe("Organization slug, e.g. 'skillist'."),
          repo: z.string().describe("Skill repo slug, e.g. 'pdf-tools'."),
        }),
        execute: async ({ org, repo }) => {
          const skill = await getRegistrySkill(db, org, repo);
          if (!skill) return { ok: false as const, reason: "skill_not_found" as const };
          return { ok: true as const, skill };
        },
      }),

      registry_facets: tool({
        description:
          "List the registry's available filter facets: categories, tags, and compatible agents. Use to discover valid category/tag values before calling search_registry, or to answer 'what categories exist?'.",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true as const, facets: await getRegistryFacets(db) }),
      }),

      validate_skill: tool({
        description:
          "Check an authored SKILL.md against the agentskills.io spec and run a security scan. Input is the full SKILL.md text (YAML frontmatter + body); optionally the intended repo slug so the skill 'name' is checked to match it. Returns validity, precise errors (frontmatter/name/paths), and any security issues so you can tell the author exactly what to fix. Use whenever a user shares or asks you to review a SKILL.md.",
        inputSchema: z.object({
          skillMd: z.string().min(1).describe("The full SKILL.md contents to validate."),
          repo: z
            .string()
            .optional()
            .describe("Intended repo slug; the frontmatter 'name' must match it when set."),
        }),
        execute: ({ skillMd, repo }) => {
          const report = validateSkillMd(skillMd, repo);
          return { ok: true as const, ...report };
        },
      }),

      search_docs: tool({
        description:
          "Retrieve passages from Skillist's own documentation (registry, publishing, coverage, delivery, MCP, sandbox, CLI, auth) to ground how-to answers. Returns doc chunks with their source page path so you can cite it. Use for 'how do I publish?', 'what's the coverage endpoint?', 'how does delivery work?' — anything about using the platform.",
        inputSchema: z.object({
          query: z.string().min(1).describe("What the user wants to know, in their words."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Max doc chunks to return (default 5)."),
        }),
        execute: async ({ query, limit }) => {
          const hits = await searchDocs(this.env, query, limit ?? 5);
          return { ok: true as const, results: hits };
        },
      }),

      // ── Org-scoped governance tools ─────────────────────────────────────────
      get_coverage: tool({
        description:
          "Required-skill coverage for this org across three layers: published (in the registry), covered (present in scanned inventory or curated into a project), and activated (agents have turned it on). Also returns drift — required skills that are not covered. Use for 'are we covered?', 'what's drifting?', coverage %.",
        inputSchema: z.object({}),
        execute: () => requireOrg((oid) => computeCoverage(db, oid)),
      }),

      list_recurring_failures: tool({
        description:
          "Recurring execution/eval failure patterns mined for this org's skills (open or drafted). Returns each pattern's skill repo, root-cause summary, occurrence count, suggested fix, and status. Use for 'what keeps breaking?', 'top failures', triage.",
        inputSchema: z.object({}),
        execute: () =>
          requireOrg(async (oid) => {
            const rows = await db
              .select({
                skillRepo: skillFailurePatterns.skillRepo,
                summary: skillFailurePatterns.summary,
                occurrences: skillFailurePatterns.occurrences,
                suggestedFix: skillFailurePatterns.suggestedFix,
                status: skillFailurePatterns.status,
              })
              .from(skillFailurePatterns)
              .innerJoin(skills, eq(skills.id, skillFailurePatterns.skillId))
              .where(
                and(
                  eq(skills.orgId, oid),
                  or(
                    eq(skillFailurePatterns.status, "open"),
                    eq(skillFailurePatterns.status, "drafted"),
                  ),
                ),
              )
              .orderBy(desc(skillFailurePatterns.occurrences))
              .limit(50);
            return { ok: true as const, patterns: rows };
          }),
      }),

      list_required_skills: tool({
        description:
          "The skills this org has declared as required (its governance baseline). Returns org slug + skill repo refs. Use for 'what do we require?' or before recommending additions.",
        inputSchema: z.object({}),
        execute: () =>
          requireOrg(async (oid) => {
            const rows = await db
              .select({
                orgSlug: orgRequiredSkills.orgSlug,
                skillRepo: orgRequiredSkills.skillRepo,
              })
              .from(orgRequiredSkills)
              .where(eq(orgRequiredSkills.orgId, oid));
            return { ok: true as const, required: rows };
          }),
      }),

      recommend_required_skills: tool({
        description:
          "Suggest popular registry skills (ranked by installs, then stars) that this org does NOT already require — candidates to add to the governance baseline. Read-only suggestion; it does not change anything. Use for 'what should we require?' / 'what are we missing?'.",
        inputSchema: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("How many recommendations to return (default 8)."),
        }),
        execute: ({ limit }) =>
          requireOrg(async (oid) => {
            const required = await db
              .select({
                orgSlug: orgRequiredSkills.orgSlug,
                skillRepo: orgRequiredSkills.skillRepo,
              })
              .from(orgRequiredSkills)
              .where(eq(orgRequiredSkills.orgId, oid));
            const requiredSet = new Set(required.map((r) => `${r.orgSlug}/${r.skillRepo}`));

            const candidates = await db
              .select({
                orgSlug: registryEntries.orgSlug,
                skillRepo: registryEntries.skillRepo,
                name: registryEntries.name,
                description: registryEntries.description,
                installCount: registryEntries.installCount,
                stars: registryEntries.stars,
              })
              .from(registryEntries)
              .orderBy(desc(registryEntries.installCount), desc(registryEntries.stars))
              .limit(60);

            const recommendations = candidates
              .filter((c) => !requiredSet.has(`${c.orgSlug}/${c.skillRepo}`))
              .slice(0, limit ?? 8);
            return { ok: true as const, recommendations };
          }),
      }),

      flag_stale_evals: tool({
        description:
          "This org's skills whose most recent eval failed, or is older than ~30 days, or was never run. Returns skill repo, latest eval status, when it last ran, and why it's flagged. Use for 'which skills need re-evaluation?' / eval health.",
        inputSchema: z.object({}),
        execute: () =>
          requireOrg(async (oid) => {
            const orgSkills = await db
              .select({ id: skills.id, repo: skills.repo })
              .from(skills)
              .where(eq(skills.orgId, oid));
            if (orgSkills.length === 0) return { ok: true as const, stale: [] };

            const skillIds = orgSkills.map((s) => s.id);
            const evals = await db
              .select({
                skillId: skillEvals.skillId,
                status: skillEvals.status,
                createdAt: skillEvals.createdAt,
                completedAt: skillEvals.completedAt,
              })
              .from(skillEvals)
              .where(inArray(skillEvals.skillId, skillIds))
              .orderBy(desc(skillEvals.createdAt));

            // Keep only the newest eval per skill (rows arrive newest-first).
            const latestBySkill = new Map<string, (typeof evals)[number]>();
            for (const ev of evals) {
              if (!latestBySkill.has(ev.skillId)) latestBySkill.set(ev.skillId, ev);
            }

            type StaleEntry = {
              skillRepo: string;
              status: string | null;
              lastEvalAt: Date | null;
              reason: "never_evaluated" | "failed" | "stale";
            };
            const cutoff = Date.now() - STALE_EVAL_DAYS * 24 * 60 * 60 * 1000;
            const stale = orgSkills.flatMap<StaleEntry>((s) => {
              const latest = latestBySkill.get(s.id);
              if (!latest) {
                return [
                  { skillRepo: s.repo, status: null, lastEvalAt: null, reason: "never_evaluated" },
                ];
              }
              const at = latest.completedAt ?? latest.createdAt;
              if (latest.status === "failed") {
                return [
                  { skillRepo: s.repo, status: latest.status, lastEvalAt: at, reason: "failed" },
                ];
              }
              if (at && at.getTime() < cutoff) {
                return [
                  { skillRepo: s.repo, status: latest.status, lastEvalAt: at, reason: "stale" },
                ];
              }
              return [];
            });
            return { ok: true as const, stale };
          }),
      }),

      draft_improvement: tool({
        description:
          "Open an AGENT-sourced improvement request against one of this org's skills. It lands as PENDING feedback in the human review inbox — approving it kicks off the existing AI-draft loop. Does NOT edit the skill directly. Use when a failure or gap warrants a concrete fix. Provide the skill repo and a specific note describing the problem and suggested change.",
        inputSchema: z.object({
          skillRepo: z
            .string()
            .describe("The skill's repo slug within this org, e.g. 'pdf-tools'."),
          note: z
            .string()
            .min(10)
            .describe("Specific problem + suggested change. This becomes the feedback body."),
        }),
        // The one WRITE tool → gated behind human approval. The first call
        // records a PENDING approval and returns `awaiting_approval` without
        // writing; once a human approves in the console, a re-run executes the
        // draft and consumes the approval (a fresh identical call re-gates).
        execute: ({ skillRepo, note }) =>
          requireOrg(async (oid) => {
            if (!initiatedBy) return { ok: false as const, reason: "no_user_scope" as const };
            return requireApproval(
              db,
              {
                orgId: oid,
                userId: initiatedBy,
                toolName: "draft_improvement",
                args: { skillRepo, note },
              },
              async () => {
                const [skill] = await db
                  .select()
                  .from(skills)
                  .where(and(eq(skills.orgId, oid), eq(skills.repo, skillRepo)))
                  .limit(1);
                if (!skill) return { ok: false as const, reason: "skill_not_found" as const };
                if (!skill.latestPublishedVersionId) {
                  return { ok: false as const, reason: "no_published_version" as const };
                }

                const [row] = await db
                  .insert(feedback)
                  .values({
                    skillId: skill.id,
                    targetVersionId: skill.latestPublishedVersionId,
                    source: "agent",
                    status: "pending",
                    body: note,
                    submittedBy: null,
                  })
                  .returning({ id: feedback.id });
                if (!row) return { ok: false as const, reason: "insert_failed" as const };
                // The feedback row is agent-sourced (submittedBy stays null, like
                // failure-mining), but we surface the verified user who drove this
                // chat so the review inbox / audit can see who prompted it.
                return { ok: true as const, feedbackId: row.id, initiatedBy };
              },
            );
          }),
      }),

      // ── Durable governance memory ───────────────────────────────────────────
      remember: tool({
        description:
          "Persist a DURABLE governance fact about this org into long-term memory — an org policy, a skill's known quirk, a naming/versioning convention, an approval rule. Use a stable, descriptive key (e.g. 'policy:security-pass', 'convention:skill-naming'); re-using a key updates it. Default scope is 'org' (visible to the whole org); use 'user' for a fact about just the current user. Do NOT store ephemeral context. PII in the value is auto-redacted; the response reports what was stripped.",
        inputSchema: z.object({
          key: z.string().min(1).max(128).describe("Stable, descriptive key. Re-using it updates."),
          value: z.string().min(1).max(4000).describe("The concise fact to remember."),
          scope: z
            .enum(["org", "user"])
            .optional()
            .describe("'org' (default) = org-wide; 'user' = only the current user."),
        }),
        execute: ({ key, value, scope }) =>
          requireOrg(async (oid) => {
            if (scope === "user" && !initiatedBy) {
              return { ok: false as const, reason: "no_user_scope" as const };
            }
            const { redaction } = await rememberFact(db, {
              orgId: oid,
              userId: scope === "user" ? initiatedBy : null,
              key,
              value,
            });
            return { ok: true as const, key, scope: scope ?? "org", redacted: redaction.matches };
          }),
      }),

      search_memory: tool({
        description:
          "Search this org's durable governance memory (org-wide facts plus your own). Optionally filter by a keyword over key/value. Use before `remember` to avoid duplicates, or to recall a policy/convention.",
        inputSchema: z.object({
          query: z.string().optional().describe("Keyword filter over key/value; omit to list all."),
        }),
        execute: ({ query }) =>
          requireOrg(async (oid) => {
            const rows = await searchMemory(db, oid, initiatedBy, query);
            return {
              ok: true as const,
              memories: rows.map((r) => ({
                key: r.key,
                value: r.value,
                scope: r.userId ? ("user" as const) : ("org" as const),
              })),
            };
          }),
      }),

      forget: tool({
        description:
          "Delete a durable governance memory by its key (an org-wide fact or your own). Use when a policy/convention no longer applies or was recorded in error.",
        inputSchema: z.object({
          key: z.string().min(1).max(128).describe("The exact key of the memory to forget."),
        }),
        execute: ({ key }) =>
          requireOrg(async (oid) => {
            await forgetFact(db, oid, initiatedBy, key);
            return { ok: true as const, key };
          }),
      }),
    };

    return this.withToolAudit(tools, db, orgId, initiatedBy);
  }

  /**
   * Wrap every tool's `execute` with a best-effort `agent.tool_called` audit
   * event. The audit write is fired off the critical path (not awaited) so a
   * slow Postgres never adds latency to the stream — mirroring how the rest of
   * the codebase fires audit/telemetry. Non-executing tool defs pass through.
   */
  private withToolAudit(
    tools: ToolSet,
    db: WorkerDb,
    orgId: string | null,
    userId: string | null,
  ): ToolSet {
    const chatId = this.chatId();
    const wrapped: ToolSet = {};
    for (const [name, def] of Object.entries(tools)) {
      const original = def.execute;
      if (typeof original !== "function") {
        wrapped[name] = def;
        continue;
      }
      const exec = original as (input: unknown, options: unknown) => unknown;
      wrapped[name] = {
        ...def,
        execute: (input: unknown, options: unknown) => {
          void logAudit(db, {
            orgId,
            actorId: userId,
            actorType: "user",
            action: "agent.tool_called",
            resourceType: "agent_tool",
            resourceId: name,
            metadata: { chatId },
          }).catch(() => {});
          return exec(input, options);
        },
      } as ToolSet[string];
    }
    return wrapped;
  }
}

/** Concatenate the text parts of a UIMessage. */
function extractText(message: UIMessage): string {
  const parts = (message.parts ?? []) as Array<{ type: string; text?: string }>;
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();
}

/** Drop variants with duplicate ids (preserve order, keep the last write). */
function dedupeVariants(variants: AssistantVariant[]): AssistantVariant[] {
  const seen = new Map<string, AssistantVariant>();
  for (const v of variants) seen.set(v.id, v);
  return [...seen.values()];
}

// Register client-callable RPCs. Using the functional `callable()(fn, null)`
// form (NOT the `@callable` decorator) so no `experimentalDecorators` /
// `emitDecoratorMetadata` compiler flags are required — TypeScript 7 + the
// repo's tsconfig don't enable them.
const CALLABLE_METHODS = ["regenerateMessage", "cleanup"] as const;
for (const name of CALLABLE_METHODS) {
  const fn = (SkillistAgent.prototype as unknown as Record<string, unknown>)[name];
  if (typeof fn === "function") {
    callable()(fn as never, null as never);
  }
}
