import {
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClients,
  oauthConsents,
} from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedUser, testDb } from "../test-support/db";
import { applyRetention, RETENTION } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("OAuth retention", () => {
  it("prunes abandoned clients and expired rows, and keeps what is in use", async () => {
    const db = testDb();
    const now = Date.now();
    const old = new Date(now - (RETENTION.oauthAbandonedClientDays + 1) * DAY_MS);
    const user = await seedUser(db);
    const id = (name: string) => `${name}-${crypto.randomUUID()}`;
    const client = (clientId: string, createdAt: Date, userId: string | null = null) => ({
      id: id("row"),
      clientId,
      redirectUris: "[]",
      createdAt,
      userId,
    });

    const abandoned = id("abandoned");
    const recent = id("recent");
    const consented = id("consented");
    const owned = id("owned");
    await db
      .insert(oauthClients)
      .values([
        client(abandoned, old),
        client(recent, new Date(now)),
        client(consented, old),
        client(owned, old, user.id),
      ]);
    await db.insert(oauthConsents).values({
      id: id("consent"),
      clientId: consented,
      userId: user.id,
      scopes: "[]",
      createdAt: old,
      updatedAt: old,
    });

    const expired = new Date(now - (RETENTION.oauthTokensAfterExpiryDays + 1) * DAY_MS);
    const live = new Date(now + DAY_MS);
    const token = (expiresAt: Date) => ({
      id: id("token"),
      token: id("value"),
      clientId: owned,
      expiresAt,
      createdAt: old,
      scopes: "[]",
    });
    const expiredToken = token(expired);
    const liveToken = token(live);
    await db.insert(oauthAccessTokens).values([expiredToken, liveToken]);
    const assertion = id("assertion");
    await db.insert(oauthClientAssertions).values({ id: assertion, expiresAt: expired });

    await applyRetention(db, now);

    const clientExists = async (clientId: string) =>
      (await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId))).length > 0;
    expect(await clientExists(abandoned)).toBe(false);
    expect(await clientExists(recent)).toBe(true);
    expect(await clientExists(consented)).toBe(true);
    expect(await clientExists(owned)).toBe(true);

    const tokenExists = async (tokenId: string) =>
      (await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, tokenId))).length >
      0;
    expect(await tokenExists(expiredToken.id)).toBe(false);
    expect(await tokenExists(liveToken.id)).toBe(true);
    expect(
      await db.select().from(oauthClientAssertions).where(eq(oauthClientAssertions.id, assertion)),
    ).toHaveLength(0);
  });
});
