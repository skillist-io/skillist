import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    getSession: () => getSession(),
    signIn: {},
    signOut: vi.fn(),
    useSession: vi.fn(),
  }),
}));
vi.mock("better-auth/client/plugins", () => ({ magicLinkClient: () => ({}) }));
vi.mock("@better-auth/passkey/client", () => ({ passkeyClient: () => ({}) }));

const { getSharedSession, clearSessionCache } = await import("./auth-client");

const ok = () => ({ data: { user: { id: "user_1" }, session: { id: "s1" } }, error: null });
const fail = (status: number) => ({ data: null, error: { status, message: "nope" } });

/**
 * Route guards call getSession() on every navigation and every hover-preload,
 * and each call spends from a per-IP rate-limit budget shared by everyone
 * behind the same NAT. These cover the collapsing that keeps that budget sane.
 */
describe("getSharedSession", () => {
  beforeEach(() => {
    getSession.mockReset();
    clearSessionCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses concurrent callers onto a single request", async () => {
    let resolve!: (v: unknown) => void;
    getSession.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );

    // Four route matches resolving at once — the hover-preload burst.
    const all = Promise.all([
      getSharedSession(),
      getSharedSession(),
      getSharedSession(),
      getSharedSession(),
    ]);
    resolve(ok());
    const results = await all;

    expect(getSession).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.data?.user).toEqual({ id: "user_1" });
  });

  it("reuses a clean answer within the TTL", async () => {
    getSession.mockResolvedValue(ok());

    await getSharedSession();
    await vi.advanceTimersByTimeAsync(10_000);
    await getSharedSession();

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    getSession.mockResolvedValue(ok());

    await getSharedSession();
    await vi.advanceTimersByTimeAsync(20_000);
    await getSharedSession();

    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("never caches an error", async () => {
    // A cached 429 would turn one throttled request into a guaranteed failure
    // for every route in the app until the TTL expired.
    getSession.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok());

    const first = await getSharedSession();
    const second = await getSharedSession();

    expect(first.error?.status).toBe(429);
    expect(second.data?.user).toEqual({ id: "user_1" });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("forgets the session once cleared", async () => {
    getSession.mockResolvedValue(ok());

    await getSharedSession();
    // What sign-out does — without it a guard could wave a signed-out user
    // straight back through for the rest of the TTL.
    clearSessionCache();
    await getSharedSession();

    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
