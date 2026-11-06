import { randomBytes, randomUUID } from "node:crypto";

/** Production D1, from apps/api/wrangler.production.jsonc. */
const DATABASE_ID = "9b901aed-8945-4574-ae3c-65c9430d05c2";
const TOKEN_TTL_MS = 60_000;

type Row = Record<string, unknown>;
export type Query = (sql: string, params: unknown[]) => Promise<Row[]>;

type StorageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

/** Run SQL against production through the Cloudflare API, as the deploy jobs do. */
export function d1Query(accountId: string, apiToken: string): Query {
  return async (sql, params) => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!res.ok) throw new Error(`D1 query failed with ${res.status}`);
    const body = (await res.json()) as { result: { results: Row[] }[] };
    return body.result[0]?.results ?? [];
  };
}

/** Turn `Set-Cookie` headers into Playwright storage-state cookies. */
export function parseSetCookies(headers: string[], fallbackDomain: string): StorageCookie[] {
  return headers.map((header) => {
    const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
    const split = pair.indexOf("=");
    const attr = new Map(
      attributes.map((part) => {
        const [key = "", ...value] = part.split("=");
        return [key.toLowerCase(), value.join("=")] as const;
      }),
    );
    const maxAge = attr.get("max-age");
    const sameSite = (attr.get("samesite") ?? "lax").toLowerCase();
    return {
      name: pair.slice(0, split),
      value: pair.slice(split + 1),
      domain: attr.get("domain") || fallbackDomain,
      path: attr.get("path") || "/",
      expires: maxAge ? Math.floor(Date.now() / 1000) + Number(maxAge) : -1,
      httpOnly: attr.has("httponly"),
      secure: attr.has("secure"),
      sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax",
    };
  });
}

/**
 * Sign the e2e user in for this run, so no saved session has to be kept alive.
 *
 * Sessions last 7 days, which made a stored one a weekly chore. Instead this
 * writes the same single-use row a magic-link email would create, then redeems it.
 * Redeeming needs no email and no `BETTER_AUTH_SECRET`, because the API signs the
 * cookie itself.
 *
 * The two checks matter: verify creates an account for an unknown email, and this
 * must never be able to mint a session for someone who owns an org.
 */
export async function mintSession(email: string, apiUrl: string, query: Query) {
  const [user] = await query("SELECT id FROM users WHERE email = ?", [email]);
  if (!user) throw new Error("No user for E2E_USER_EMAIL. Create that account first.");

  const owned = await query("SELECT 1 FROM org_members WHERE user_id = ? AND role = 'owner'", [
    user.id,
  ]);
  if (owned.length > 0) {
    throw new Error("E2E_USER_EMAIL owns an org. Use a test user that doesn't.");
  }

  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await query(
    "INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      randomUUID(),
      `magic-link:${token}`,
      JSON.stringify({ type: "magic-link", email }),
      now + TOKEN_TTL_MS,
      now,
      now,
    ],
  );

  // No callbackURL: verify answers 200 rather than redirecting, so a bad token
  // shows up as a failed status instead of a redirect to an error page.
  const res = await fetch(`${apiUrl}/api/auth/magic-link/verify?token=${token}`, {
    redirect: "manual",
  });
  const cookies = parseSetCookies(res.headers.getSetCookie(), new URL(apiUrl).hostname);
  const session = cookies.find((c) => c.name.includes("session_token"));
  if (res.status !== 200 || !session) {
    throw new Error(`Magic-link verify returned ${res.status} without a session cookie.`);
  }
  // A new browser gets the consent banner, which is fixed to the bottom of the
  // screen and covers buttons. Declining also keeps CI out of the analytics.
  const consent = { ...session, name: "skillist-consent", value: "denied", httpOnly: false };
  return { cookies: [...cookies, consent], origins: [] };
}
