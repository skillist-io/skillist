import type { Env } from "../env";
import type { WorkerDb } from "./db";
import { eq } from "drizzle-orm";
import {
  skillEvals,
  skillVersions,
  skills,
} from "@skillist/db/schema";
import {
  downloadBundleFromR2,
  listBundlePaths,
} from "./r2";

const DEFAULT_SCENARIOS = [
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

function parseScore(text: string): number {
  const match = text.match(/\d{1,3}/);
  const n = match ? Number(match[0]) : 50;
  return Math.min(100, Math.max(0, n));
}

export async function runSkillEval(
  env: Env,
  db: WorkerDb,
  evalId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(skillEvals)
    .where(eq(skillEvals.id, evalId))
    .limit(1);
  if (!row) return;

  await db
    .update(skillEvals)
    .set({ status: "running" })
    .where(eq(skillEvals.id, evalId));

  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, row.skillId))
    .limit(1);
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

  const scenarios =
    (row.scenarios as { name: string; prompt: string }[] | null) ??
    DEFAULT_SCENARIOS;

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(
    env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const skillMd = bundle.get("SKILL.md") ?? "";

  let baselineTotal = 0;
  let withSkillTotal = 0;

  for (const scenario of scenarios) {
    const baseline = await scorePrompt(env, scenario.prompt);
    const withSkill = await scorePrompt(
      env,
      `${scenario.prompt}\n\nRelevant skill instructions:\n${skillMd.slice(0, 8000)}`,
    );
    baselineTotal += baseline;
    withSkillTotal += withSkill;
  }

  const baselineScore = Math.round(baselineTotal / scenarios.length);
  const withSkillScore = Math.round(withSkillTotal / scenarios.length);
  const uplift = withSkillScore - baselineScore;

  await db
    .update(skillEvals)
    .set({
      status: "completed",
      baselineScore,
      withSkillScore,
      uplift,
      completedAt: new Date(),
    })
    .where(eq(skillEvals.id, evalId));
}
