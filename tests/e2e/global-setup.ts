import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const AUTH_STATE_PATH = path.join(process.cwd(), "tests/e2e/.auth/user.json");

export default async function globalSetup() {
  const b64 = process.env.E2E_AUTH_STATE_B64;
  if (!b64) {
    // Skipping must stay visible: a green run here hasn't touched a signed-in page.
    // This lives here rather than in the config, which every worker loads again.
    if (process.env.CI) {
      console.log(
        "::warning title=Signed-in e2e skipped::E2E_AUTH_STATE_B64 is not set, so no signed-in console flow was tested in this run.",
      );
    }
    return;
  }

  await mkdir(path.dirname(AUTH_STATE_PATH), { recursive: true });
  await writeFile(AUTH_STATE_PATH, Buffer.from(b64, "base64"));
}

export async function hasAuthState(): Promise<boolean> {
  if (process.env.E2E_AUTH_STATE_B64) return true;
  try {
    await access(AUTH_STATE_PATH);
    return true;
  } catch {
    return false;
  }
}
