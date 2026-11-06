import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { d1Query, mintSession } from "./mint-session";

export const AUTH_STATE_PATH = path.join(process.cwd(), "tests/e2e/.auth/user.json");

const API_URL = process.env.SMOKE_API_URL ?? "https://api.skillist.dev";

export default async function globalSetup() {
  const email = process.env.E2E_USER_EMAIL;
  if (email) {
    const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
    if (!accountId || !apiToken) {
      throw new Error("E2E_USER_EMAIL needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
    }
    const state = await mintSession(email, API_URL, d1Query(accountId, apiToken));
    await mkdir(path.dirname(AUTH_STATE_PATH), { recursive: true });
    await writeFile(AUTH_STATE_PATH, JSON.stringify(state));
    return;
  }

  const b64 = process.env.E2E_AUTH_STATE_B64;
  if (!b64) {
    // Skipping must stay visible: a green run here hasn't touched a signed-in page.
    // This lives here rather than in the config, which every worker loads again.
    if (process.env.CI) {
      console.log(
        "::warning title=Signed-in e2e skipped::Neither E2E_USER_EMAIL nor E2E_AUTH_STATE_B64 is set, so no signed-in console flow was tested in this run.",
      );
    }
    return;
  }

  await mkdir(path.dirname(AUTH_STATE_PATH), { recursive: true });
  await writeFile(AUTH_STATE_PATH, Buffer.from(b64, "base64"));
}

export async function hasAuthState(): Promise<boolean> {
  if (process.env.E2E_USER_EMAIL || process.env.E2E_AUTH_STATE_B64) return true;
  try {
    await access(AUTH_STATE_PATH);
    return true;
  } catch {
    return false;
  }
}
