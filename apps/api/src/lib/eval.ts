import { skillEvals, skills, skillVersions } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import type { WorkerDb } from "./db";
import { downloadBundleFromR2, listBundlePaths } from "./r2";

export type EvalScenario = {
  name: string;
  prompt: string;
  /** Optional expected cues the with-skill run should satisfy */
  criteria?: string[];
};

export type EvalScenarioResult = EvalScenario & {
  baselineScore: number;
  withSkillScore: number;
  uplift: number;
  method: "llm_judge" | "sandbox_probe";
};

const DEFAULT_SCENARIOS: EvalScenario[] = [
  {
    name: "task-clarity",
    prompt:
      "Rate 0-100 how clearly an agent could follow instructions for a generic coding task. Reply with only a number.",
  },
  {
    name: "safety-awareness",
    prompt:
      "Rate 0-100 how well instructions emphasize safe, reversible changes. Reply with only a number.",
  },
  {
    name: "tool-discipline",
    prompt:
      "Rate 0-100 how well instructions guide an agent to use tools/scripts instead of improvising. Reply with only a number.",
  },
];

async function scorePrompt(env: Env, prompt: string): Promise<number> {
  try {
    if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_TOKEN) {
      const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/skillist/workers-ai/@cf/meta/llama-3.1-8b-instruct`;
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = (await res.json()) as { result?: { response?: string } };
      return parseScore(data.result?.response ?? "50");
    }
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
    });
    return parseScore((result as { response?: string }).response ?? "50");
  } catch {
    return 50;
  }
}

async function generateScenariosFromSkill(
  env: Env,
  skillMd: string,
  count: number,
): Promise<EvalScenario[]> {
  const prompt = `Given this agent skill (SKILL.md), propose ${count} short evaluation prompts that test whether the skill helps an agent. Return JSON array only: [{"name":"...","prompt":"..."}]

SKILL.md:
${skillMd.slice(0, 6000)}`;

  try {
    let text = "";
    if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_TOKEN) {
      const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/skillist/workers-ai/@cf/meta/llama-3.1-8b-instruct`;
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      const data = (await res.json()) as { result?: { response?: string } };
      text = data.result?.response ?? "";
    } else {
      const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
      });
      text = (result as { response?: string }).response ?? "";
    }
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return DEFAULT_SCENARIOS.slice(0, count);
    const parsed = JSON.parse(match[0]) as EvalScenario[];
    return parsed
      .filter((s) => s.name && s.prompt)
      .slice(0, count)
      .map((s) => ({ name: String(s.name), prompt: String(s.prompt) }));
  } catch {
    return DEFAULT_SCENARIOS.slice(0, count);
  }
}

function parseScore(text: string): number {
  const match = text.match(/\d{1,3}/);
  const n = match ? Number(match[0]) : 50;
  return Math.min(100, Math.max(0, n));
}

/** Load durable scenarios from bundle `evals/.../scenario.json` or `evals/scenarios.json`. */
export function loadScenariosFromBundle(bundle: Map<string, string>): EvalScenario[] {
  const scenarios: EvalScenario[] = [];
  const index = bundle.get("evals/scenarios.json");
  if (index) {
    try {
      const parsed = JSON.parse(index) as EvalScenario[];
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          if (s?.name && s?.prompt)
            scenarios.push({ name: s.name, prompt: s.prompt, criteria: s.criteria });
        }
      }
    } catch {
      // ignore
    }
  }
  for (const [path, content] of bundle.entries()) {
    if (!/^evals\/[^/]+\/scenario\.json$/.test(path)) continue;
    try {
      const parsed = JSON.parse(content) as EvalScenario;
      if (parsed?.name && parsed?.prompt) scenarios.push(parsed);
    } catch {
      // ignore
    }
  }
  return scenarios;
}

/**
 * Sandbox probe: if the skill declares scripts, score whether the skill
 * documents script usage clearly (proxy for with-skill vs without uplift).
 * Full agent sandbox runs are queued separately via skill execution APIs.
 */
function sandboxProbeScores(
  skillMd: string,
  hasScripts: boolean,
): {
  baselineScore: number;
  withSkillScore: number;
} {
  const mentionsScripts = /scripts\//i.test(skillMd) || /run the script/i.test(skillMd);
  const baselineScore = hasScripts ? 40 : 55;
  const withSkillScore = hasScripts
    ? mentionsScripts
      ? 75
      : 50
    : /step|procedure|workflow/i.test(skillMd)
      ? 70
      : 55;
  return { baselineScore, withSkillScore };
}

export async function runSkillEval(env: Env, db: WorkerDb, evalId: string): Promise<void> {
  const [row] = await db.select().from(skillEvals).where(eq(skillEvals.id, evalId)).limit(1);
  if (!row) return;

  await db.update(skillEvals).set({ status: "running" }).where(eq(skillEvals.id, evalId));

  const [skill] = await db.select().from(skills).where(eq(skills.id, row.skillId)).limit(1);
  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, row.versionId))
    .limit(1);
  if (!skill || !version) {
    await db
      .update(skillEvals)
      .set({ status: "failed", error: "Skill or version not found" })
      .where(eq(skillEvals.id, evalId));
    return;
  }

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const skillMd = bundle.get("SKILL.md") ?? "";
  const hasScripts = [...bundle.keys()].some((p) => p.startsWith("scripts/"));

  let scenarios = row.scenarios?.length ? row.scenarios : loadScenariosFromBundle(bundle);
  if (!scenarios.length) {
    // Auto-generate when none persisted
    scenarios = await generateScenariosFromSkill(env, skillMd, 3);
  }

  const results: EvalScenarioResult[] = [];
  let baselineTotal = 0;
  let withSkillTotal = 0;

  // Prefer sandbox probe signal when scripts exist; still run LLM judges per scenario
  const probe = hasScripts ? sandboxProbeScores(skillMd, hasScripts) : null;

  for (const scenario of scenarios) {
    const baseline = await scorePrompt(env, scenario.prompt);
    const withSkill = await scorePrompt(
      env,
      `${scenario.prompt}\n\nRelevant skill instructions:\n${skillMd.slice(0, 8000)}`,
    );
    let baselineScore = baseline;
    let withSkillScore = withSkill;
    let method: EvalScenarioResult["method"] = "llm_judge";

    if (probe) {
      // Blend LLM judge with sandbox documentation probe (60/40)
      baselineScore = Math.round(baseline * 0.6 + probe.baselineScore * 0.4);
      withSkillScore = Math.round(withSkill * 0.6 + probe.withSkillScore * 0.4);
      method = "sandbox_probe";
    }

    const uplift = withSkillScore - baselineScore;
    results.push({
      ...scenario,
      baselineScore,
      withSkillScore,
      uplift,
      method,
    });
    baselineTotal += baselineScore;
    withSkillTotal += withSkillScore;
  }

  const baselineScore = Math.round(baselineTotal / scenarios.length);
  const withSkillScore = Math.round(withSkillTotal / scenarios.length);
  const uplift = withSkillScore - baselineScore;

  // Persist generated scenarios onto the eval row for regression reuse
  await db
    .update(skillEvals)
    .set({
      status: "completed",
      baselineScore,
      withSkillScore,
      uplift,
      results,
      scenarios,
      completedAt: new Date(),
    })
    .where(eq(skillEvals.id, evalId));
}

export { DEFAULT_SCENARIOS, generateScenariosFromSkill };
