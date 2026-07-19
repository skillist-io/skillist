import { describe, expect, it } from "vitest";
import { redactPII } from "./pii";

describe("redactPII", () => {
  it("redacts email, ssn, phone, and card, tallying each", () => {
    const { text, matches } = redactPII(
      "reach me at a@b.com or 555-123-4567, ssn 123-45-6789, card 4111 1111 1111 1111",
    );
    expect(text).toContain("[email]");
    expect(text).toContain("[phone]");
    expect(text).toContain("[ssn]");
    expect(text).toContain("[card]");
    expect(text).not.toMatch(/a@b\.com|123-45-6789/);
    const names = matches.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["email", "ssn", "phone", "credit_card"]));
  });

  it("leaves clean text untouched with no matches", () => {
    const { text, matches } = redactPII("the org requires a security pass on every skill");
    expect(text).toBe("the org requires a security pass on every skill");
    expect(matches).toEqual([]);
  });

  it("handles empty/non-string input", () => {
    expect(redactPII("").text).toBe("");
    // @ts-expect-error runtime guard for non-string
    expect(redactPII(null).text).toBe("");
  });
});
