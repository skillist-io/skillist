import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

// Mocked at the shared-session boundary: these cases cover the retry and
// error-classification logic, not the dedupe/TTL layer (tested in @skillist/ui).
vi.mock("@skillist/ui", () => ({
  getSharedSession: () => getSession(),
}));

const { requireAuth } = await import("./require-auth");

/** A Better Auth success envelope. */
const ok = (user: { id: string } | null) => ({
  data: user ? { user, session: { id: "sess_1" } } : null,
  error: null,
});

/** A Better Auth error envelope. */
const fail = (status: number) => ({
  data: null,
  error: { status, message: `HTTP ${status}` },
});

/** Captures the redirect a `beforeLoad` guard throws. */
async function captureRedirect(): Promise<Record<string, unknown>> {
  try {
    await requireAuth();
  } catch (err) {
    if (!isRedirect(err)) throw err;
    return err as unknown as Record<string, unknown>;
  }
  throw new Error("expected requireAuth to redirect");
}

/** TanStack has moved redirect options between top level and `.options`. */
function searchOf(redirectErr: Record<string, unknown>): Record<string, unknown> {
  const options = (redirectErr.options ?? redirectErr) as Record<string, unknown>;
  return (options.search ?? {}) as Record<string, unknown>;
}

describe("requireAuth", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("returns the session on the happy path without retrying", async () => {
    getSession.mockResolvedValueOnce(ok({ id: "user_1" }));

    const session = await requireAuth();

    expect(session.user).toEqual({ id: "user_1" });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and keeps the user signed in when it succeeds", async () => {
    // The regression this file exists for: /api/auth/* was rate limited to
    // 20 req/min per IP, so ordinary navigation 429'd and signed people out.
    getSession.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok({ id: "user_1" }));

    const session = await requireAuth();

    expect(session.user).toEqual({ id: "user_1" });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("retries a 500 and keeps the user signed in when it succeeds", async () => {
    getSession.mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok({ id: "user_1" }));

    await expect(requireAuth()).resolves.toMatchObject({ user: { id: "user_1" } });
  });

  it("retries a network-level failure", async () => {
    getSession.mockRejectedValueOnce(new TypeError("fetch failed"));
    getSession.mockResolvedValueOnce(ok({ id: "user_1" }));

    await expect(requireAuth()).resolves.toMatchObject({ user: { id: "user_1" } });
  });

  it("reports a persistent 429 as unreachable, never as an invalid session", async () => {
    getSession.mockResolvedValue(fail(429));

    const search = searchOf(await captureRedirect());

    // Must NOT be session_unavailable: the session is fine, the API is not.
    expect(search.error).toBe("auth_unreachable");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("reports a persistent network failure as unreachable", async () => {
    getSession.mockRejectedValue(new TypeError("fetch failed"));

    expect(searchOf(await captureRedirect()).error).toBe("auth_unreachable");
  });

  it("treats an explicit 401 as a rejected session and does not retry", async () => {
    getSession.mockResolvedValue(fail(401));

    const search = searchOf(await captureRedirect());

    expect(search.error).toBe("session_unavailable");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit 403 as a rejected session", async () => {
    getSession.mockResolvedValue(fail(403));

    expect(searchOf(await captureRedirect()).error).toBe("session_unavailable");
  });

  it("redirects with no error banner when the response is clean but has no user", async () => {
    getSession.mockResolvedValue(ok(null));

    const search = searchOf(await captureRedirect());

    // Ordinary signed-out visitor — nothing went wrong, so nothing to apologise for.
    expect(search.error).toBeUndefined();
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
