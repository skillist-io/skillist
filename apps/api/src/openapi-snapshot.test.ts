import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

/**
 * Pins the served OpenAPI document.
 *
 * The recurring failure mode in this codebase has been the spec quietly
 * diverging from the code: a /v1-doubled server URL that 404'd every "Try it",
 * 96 operations with no operationId, 64 responses with no schema. None of it
 * was visible in review, because nothing rendered the API surface as a
 * reviewable artifact.
 *
 * This makes any change to the public API show up as a diff in the pull
 * request. It is not a correctness check — it is a "did you mean to change the
 * contract?" check, and the answer is usually yes.
 *
 * Intentional change? Re-record it:
 *   pnpm --filter @skillist/api exec vitest run src/openapi-snapshot.test.ts -u
 */
it("matches the committed OpenAPI snapshot", async () => {
  const res = await SELF.fetch("http://localhost/openapi.json");
  expect(res.status).toBe(200);
  const doc = await res.json();
  await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot(
    "./__snapshots__/openapi.json",
  );
});
