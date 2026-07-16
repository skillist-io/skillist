import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const AUTH_STATE_PATH = path.join(process.cwd(), "tests/e2e/.auth/user.json");

export default async function globalSetup() {
  const b64 = process.env.E2E_AUTH_STATE_B64;
  if (!b64) return;

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
