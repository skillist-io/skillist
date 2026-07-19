import { createAnthropic } from "@ai-sdk/anthropic";
import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  feedback,
  orgRequiredSkills,
  registryEntries,
  skillEvals,
  skillFailurePatterns,
  skills,
} from "@skillist/db/schema";
import { convertToModelMessages, stepCountIs, streamText, type ToolSet, tool } from "ai";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { Env } from "../env";
import { computeCoverage } from "../lib/coverage";
import { createWorkerDb, type WorkerDb } from "../lib/db";

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

const SYSTEM_PROMPT = [
  "You are the Skillist platform agent for this organization.",
  "You help governing teams manage their agent skills: coverage of required skills,",
  "recurring execution failures, eval health, and improvements.",
  "Be precise, technical, and calm. Never invent skills or numbers — call a tool.",
].join(" ");

type SkillistAgentState = { orgId: string | null };

export class SkillistAgent extends AIChatAgent<Env, SkillistAgentState> {
  initialState: SkillistAgentState = { orgId: null };

  /**
   * The DO instance name IS the orgId — routing keys the instance by orgId
   * (`/agents/skillist-agent/{orgId}`), and `getServerByName(idFromName(orgId))`
   * makes `this.name` the stable, un-spoofable org identity for this instance.
   */
  private orgId(): string | null {
    return this.state?.orgId ?? this.name ?? null;
  }

  /**
   * Verified userId injected by the Worker gate as `?uid=` (see index.ts →
   * gateAgentRequest). Kept for audit/attribution on the draft_improvement
   * write path; the client can't spoof it because the Worker strips any
   * client-supplied `uid` before adding the session-verified value.
   */
  private currentUserId: string | null = null;

  async onConnect(
    ...args: Parameters<AIChatAgent<Env, SkillistAgentState>["onConnect"]>
  ): Promise<void> {
    const ctx = args[1] as { request?: Request } | undefined;
    try {
      if (ctx?.request) {
        const uid = new URL(ctx.request.url).searchParams.get("uid");
        if (uid) this.currentUserId = uid;
      }
    } catch {
      /* ignore — attribution falls back to null */
    }
    // The instance name is the orgId. Promote it to durable state so tools have
    // it after hibernation even when onConnect hasn't re-fired.
    const orgId = this.name ?? null;
    if (orgId && this.state?.orgId !== orgId) {
      this.setState({ ...(this.state ?? this.initialState), orgId });
    }
    return super.onConnect(...args);
  }

  async onChatMessage() {
    // Prefer Claude for reliable tool-calling; fall back to Workers AI when no
    // Anthropic key is configured so the agent still runs (with weaker tool use).
    const model = this.env.ANTHROPIC_API_KEY
      ? createAnthropic({
          apiKey: this.env.ANTHROPIC_API_KEY,
          // When an AI Gateway account is set, route Anthropic through the
          // Cloudflare AI Gateway for caching + observability ("skillist" is the
          // gateway name). Otherwise the provider calls the Anthropic API directly.
          ...(this.env.AI_GATEWAY_ACCOUNT_ID
            ? {
                baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ACCOUNT_ID}/skillist/anthropic`,
                // Authenticates to a secured gateway. The Anthropic key itself
                // still travels as x-api-key (set by the provider) to the upstream.
                headers: this.env.AI_GATEWAY_TOKEN
                  ? { "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}` }
                  : undefined,
              }
            : {}),
        })(CLAUDE_MODEL_ID)
      : // sessionAffinity pins this DO's turns to one Workers AI replica.
        createWorkersAI({ binding: this.env.AI })(WORKERS_MODEL_ID, {
          sessionAffinity: this.sessionAffinity,
        });
    const orgId = this.orgId();
    const db = createWorkerDb(this.env);
    const tools = this.buildTools(db, orgId, this.currentUserId);

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse();
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

    return {
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
        execute: ({ skillRepo, note }) =>
          requireOrg(async (oid) => {
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
          }),
      }),
    };
  }
}
