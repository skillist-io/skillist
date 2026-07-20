import { describe, expect, it } from "vitest";
import { confirmsAccountDeletion } from "./account-deletion";

describe("confirmsAccountDeletion", () => {
  const email = "blake@example.com";

  it("confirms on an exact match", () => {
    expect(confirmsAccountDeletion(email, email)).toBe(true);
  });

  it("ignores casing and surrounding whitespace", () => {
    // Matching the casing of your own address proves nothing; deliberate intent
    // is the point.
    expect(confirmsAccountDeletion("  BLAKE@Example.com  ", email)).toBe(true);
  });

  it("refuses an empty confirmation", () => {
    expect(confirmsAccountDeletion("", email)).toBe(false);
    expect(confirmsAccountDeletion("   ", email)).toBe(false);
  });

  it("refuses a different address", () => {
    expect(confirmsAccountDeletion("someone@example.com", email)).toBe(false);
  });

  it("refuses a partial match", () => {
    // Guards against ever relaxing this to a substring check.
    expect(confirmsAccountDeletion("blake", email)).toBe(false);
    expect(confirmsAccountDeletion(`${email}x`, email)).toBe(false);
  });

  it("never confirms when the account email is unknown", () => {
    // The session may not have loaded yet — an empty email must not arm the
    // button, and must not be satisfiable by typing nothing.
    expect(confirmsAccountDeletion("", "")).toBe(false);
    expect(confirmsAccountDeletion("anything", "")).toBe(false);
  });
});
