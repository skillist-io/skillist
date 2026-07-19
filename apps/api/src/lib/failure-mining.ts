import {
  feedback,
  organizations,
  skillEvals,
  skillFailurePatterns,
  skillRuns,
  skills,
} from "@skillist/db/schema";
import { and, desc, eq, gte, or } from "drizzle-orm";
import type { Env } from "../env";
import type { WorkerDb } from "./db";
import { runModel } from "./model";
import { sha256 } from "./r2";

/** Only recent failures matter — patterns older than this are stale/resolved. */
const FAILURE_WINDOW_DAYS = 14;
/** Upper bound on failures pulled per source, most-recent first. */
const MAX_FAILURES = 200;
/** Cosine score at/above which two failure signatures are the same pattern. */
const CLUSTER_THRESHOLD = 0.9;
/** A cluster must recur at least this many times before we open feedback. */
const MIN_OCCURRENCES = 3;
/** How many exemplar error texts / run ids we keep per pattern. */
const MAX_EXEMPLARS = 5;
/** BGE base produces 768-dim embeddings. */
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

/**
 * Embeds a single failure text into a 768-dim vector via Workers AI (BGE base).
 * Returns `[]` when the model yields no data so callers can skip the failure
 * rather than upserting a degenerate vector.
 */
export async function embedFailure(env: Env, text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const res = (await env.AI.run(EMBEDDING_MODEL, { text: [trimmed] })) as {
    data?: number[][];
  };
  return res.data?.[0] ?? [];
}

/**
 * Normalizes a raw failure message so semantically-identical failures collapse
 * to one signature: strips volatile tokens (uuids, long hex, filesystem paths,
 * long digit runs), collapses whitespace, and bounds the length.
 */
export function normalizeFailureText(raw: string): string {
  return raw
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/(?:\/[\w.-]+){2,}/g, "<path>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function signatureOf(normalized: string): Promise<string> {
  return (await sha256(normalized)).slice(0, 16);
}

type RawFailure = {
  /** skillRuns.id for run failures; null for eval failures (no run id). */
  runId: string | null;
  /** Raw text shown to the model as an exemplar. */
  rawText: string;
  /** Normalized text used for embedding + signature. */
  signatureText: string;
  signature: string;
};

/**
 * Mines a single skill's recent run/eval failures, clusters them by embedding
 * similarity, and — for any pattern that recurs enough — records it in
 * `skillFailurePatterns` and opens an agent-sourced feedback row for a human to
 * approve. Approval feeds the existing AI-draft loop; we never enqueue that job
 * here. All DB access goes through the passed `db`.
 */
export async function mineSkillFailures(
  env: Env,
  db: WorkerDb,
  skillId: string,
): Promise<{ patterns: number; feedbackOpened: number }> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
  if (!skill) return { patterns: 0, feedbackOpened: 0 };

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, skill.orgId))
    .limit(1);
  if (!org) return { patterns: 0, feedbackOpened: 0 };

  const orgSlug = org.slug;
  const since = new Date(Date.now() - FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // 1. Gather bounded, most-recent failures from runs + evals.
  const [runRows, evalRows] = await Promise.all([
    db
      .select({
        id: skillRuns.id,
        error: skillRuns.error,
        stderr: skillRuns.stderr,
      })
      .from(skillRuns)
      .where(
        and(
          eq(skillRuns.skillId, skillId),
          eq(skillRuns.status, "failed"),
          gte(skillRuns.createdAt, since),
        ),
      )
      .orderBy(desc(skillRuns.createdAt))
      .limit(MAX_FAILURES),
    db
      .select({
        status: skillEvals.status,
        uplift: skillEvals.uplift,
        error: skillEvals.error,
        results: skillEvals.results,
      })
      .from(skillEvals)
      .where(
        and(
          eq(skillEvals.skillId, skillId),
          or(eq(skillEvals.status, "failed"), eq(skillEvals.status, "completed")),
        ),
      )
      .orderBy(desc(skillEvals.createdAt))
      .limit(MAX_FAILURES),
  ]);

  const failures: RawFailure[] = [];

  for (const run of runRows) {
    const text = (run.error ?? run.stderr ?? "").trim();
    if (!text) continue;
    const signatureText = normalizeFailureText(text);
    if (!signatureText) continue;
    failures.push({
      runId: run.id,
      rawText: text.slice(0, 500),
      signatureText,
      signature: await signatureOf(signatureText),
    });
  }

  for (const ev of evalRows) {
    const isWeak =
      (ev.status === "failed" && !!ev.error) ||
      (ev.status === "completed" && (ev.uplift ?? 0) <= 0);
    if (!isWeak) continue;
    let text = ev.error?.trim() ?? "";
    if (!text) {
      // No hard error — the weakness is "no uplift" on the worst scenario(s).
      const worst = (ev.results ?? [])
        .slice()
        .sort((a, b) => a.uplift - b.uplift)
        .map((r) => r.name)
        .slice(0, 3)
        .join(", ");
      text = `no uplift: ${worst || "unknown scenario"}`;
    }
    const signatureText = normalizeFailureText(text);
    if (!signatureText) continue;
    failures.push({
      runId: null,
      rawText: text.slice(0, 500),
      signatureText,
      signature: await signatureOf(signatureText),
    });
  }

  if (failures.length === 0) return { patterns: 0, feedbackOpened: 0 };

  // Group raw failures by signature; count occurrences per signature.
  const bySignature = new Map<string, RawFailure[]>();
  for (const f of failures) {
    const list = bySignature.get(f.signature);
    if (list) list.push(f);
    else bySignature.set(f.signature, [f]);
  }

  // 2. Embed each UNIQUE signature and upsert into Vectorize.
  const vectors = new Map<string, number[]>();
  for (const [signature, list] of bySignature) {
    const first = list[0];
    if (!first) continue;
    const values = await embedFailure(env, first.signatureText);
    if (values.length === 0) continue;
    vectors.set(signature, values);
    await env.VECTORIZE.upsert([
      {
        id: `${skillId}:${signature}`,
        values,
        metadata: { skillId, signature },
      },
    ]);
  }

  // 3. Cluster signatures by embedding similarity. Process each cluster once,
  // keyed by a deterministic representative (lexicographically-smallest sig).
  const processed = new Set<string>();
  let patterns = 0;
  let feedbackOpened = 0;

  // Deterministic iteration order for stable representatives across runs.
  const orderedSignatures = [...vectors.keys()].sort();

  for (const signature of orderedSignatures) {
    if (processed.has(signature)) continue;
    const values = vectors.get(signature);
    if (!values) continue;

    const result = await env.VECTORIZE.query(values, {
      topK: 10,
      filter: { skillId },
      returnMetadata: true,
    });

    // Cluster = this signature plus any near-neighbor signature we also mined.
    const clusterSigs = new Set<string>([signature]);
    for (const match of result.matches) {
      if (match.score < CLUSTER_THRESHOLD) continue;
      const sig = match.metadata?.signature;
      if (typeof sig === "string" && bySignature.has(sig)) clusterSigs.add(sig);
    }

    const representative = [...clusterSigs].sort()[0] ?? signature;
    if (processed.has(representative)) {
      for (const s of clusterSigs) processed.add(s);
      continue;
    }
    for (const s of clusterSigs) processed.add(s);

    const clusterFailures: RawFailure[] = [];
    for (const s of clusterSigs) clusterFailures.push(...(bySignature.get(s) ?? []));
    const occurrences = clusterFailures.length;
    if (occurrences < MIN_OCCURRENCES) continue;

    const exemplarTexts = clusterFailures.slice(0, MAX_EXEMPLARS).map((f) => f.rawText);
    const exemplarRunIds = [
      ...new Set(clusterFailures.map((f) => f.runId).filter((id): id is string => id !== null)),
    ].slice(0, MAX_EXEMPLARS);

    // 4. Draft a root-cause summary + concrete fix from the exemplars.
    const { summary, suggestedFix } = await draftPattern(env, skill.repo, exemplarTexts);

    // 5. Upsert the pattern (dedup on skill+signature) and read back its id +
    // current feedbackId to decide whether to open feedback.
    const [pattern] = await db
      .insert(skillFailurePatterns)
      .values({
        skillId,
        orgSlug,
        skillRepo: skill.repo,
        signature: representative,
        summary,
        suggestedFix,
        occurrences,
        exemplarRunIds,
        status: "open",
      })
      .onConflictDoUpdate({
        target: [skillFailurePatterns.skillId, skillFailurePatterns.signature],
        set: {
          occurrences,
          exemplarRunIds,
          summary,
          suggestedFix,
          updatedAt: new Date(),
        },
      })
      .returning();
    patterns += 1;

    // 6. Open an agent-sourced feedback row once per pattern, only when there is
    // a live version to target. Humans approve it in the inbox, which triggers
    // the existing AI-draft flow — we do NOT enqueue that job here.
    if (pattern && !pattern.feedbackId && skill.latestPublishedVersionId) {
      const body = [
        `Recurring failure detected by execution mining (${occurrences} occurrences).`,
        "",
        `Root cause: ${summary}`,
        suggestedFix ? `\nSuggested fix:\n${suggestedFix}` : "",
      ]
        .join("\n")
        .trim();

      const [fb] = await db
        .insert(feedback)
        .values({
          skillId,
          targetVersionId: skill.latestPublishedVersionId,
          source: "agent",
          status: "pending",
          body,
          submittedBy: null,
        })
        .returning();

      if (fb) {
        await db
          .update(skillFailurePatterns)
          .set({ feedbackId: fb.id, status: "drafted", updatedAt: new Date() })
          .where(eq(skillFailurePatterns.id, pattern.id));
        feedbackOpened += 1;
      }
    }
  }

  return { patterns, feedbackOpened };
}

/**
 * Asks the text model for a concise root cause + a concrete SKILL.md fix from a
 * handful of exemplar error texts. Robust to unstructured output: falls back to
 * treating the whole response as the summary when the sections are missing.
 */
async function draftPattern(
  env: Env,
  repo: string,
  exemplarTexts: string[],
): Promise<{ summary: string; suggestedFix: string | null }> {
  const prompt = `You are triaging recurring failures for the Agent Skill "${repo}".
Below are up to ${MAX_EXEMPLARS} example error messages from real executions of this skill:

${exemplarTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Identify the single most likely root cause, then propose a concrete change to the
skill's SKILL.md that would prevent it. Respond in EXACTLY this format:

SUMMARY: <one or two sentences naming the root cause>
FIX: <a specific, actionable change to SKILL.md>`;

  let raw: string;
  try {
    raw = (await runModel(env, prompt)).trim();
  } catch {
    raw = "";
  }

  if (!raw) {
    const fallback = exemplarTexts[0] ?? "Recurring failure with no captured detail.";
    return { summary: fallback.slice(0, 500), suggestedFix: null };
  }

  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?:\n\s*FIX:|$)/i);
  const fixMatch = raw.match(/FIX:\s*([\s\S]*)$/i);
  const summary = summaryMatch?.[1]?.trim() || raw;
  const suggestedFix = fixMatch?.[1]?.trim() || null;

  return { summary: summary.slice(0, 2000), suggestedFix: suggestedFix?.slice(0, 4000) ?? null };
}
