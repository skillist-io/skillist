import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { describeError, isDatabaseError } from "./error-detail";

describe("describeError", () => {
  it("surfaces the driver cause behind a Drizzle query error", () => {
    // Shape postgres-js throws when Hyperdrive drops the socket mid-query.
    const driverError = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
      severity: "FATAL",
    });
    const err = new DrizzleQueryError('select "id" from "skills"', ["org", "repo"], driverError);

    const detail = describeError(err);

    expect(detail.message).toContain("Failed query");
    expect(detail.causes).toHaveLength(1);
    expect(detail.causes?.[0]).toMatchObject({
      message: "write CONNECTION_CLOSED",
      code: "CONNECTION_CLOSED",
      severity: "FATAL",
    });
  });

  it("keeps the SQLSTATE and constraint of a unique violation", () => {
    const err = new DrizzleQueryError(
      'insert into "skills"',
      [],
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
        constraint_name: "skills_org_repo_idx",
        routine: "_bt_check_unique",
      }),
    );

    expect(describeError(err).causes?.[0]).toMatchObject({
      code: "23505",
      constraint: "skills_org_repo_idx",
      routine: "_bt_check_unique",
    });
  });

  it("omits `causes` for a plain error", () => {
    const detail = describeError(new Error("boom"));
    expect(detail).toMatchObject({ name: "Error", message: "boom" });
    expect(detail.causes).toBeUndefined();
  });

  it("does not log the Postgres detail/hint fields, which echo row values", () => {
    const err = Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Key (email)=(person@example.com) already exists.",
      hint: "try another email",
    });

    expect(JSON.stringify(describeError(err))).not.toContain("person@example.com");
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;

    expect(describeError(a).causes).toHaveLength(1);
  });

  it("handles a thrown non-error", () => {
    expect(describeError("just a string")).toMatchObject({ message: "just a string" });
  });
});

describe("isDatabaseError", () => {
  it("recognises a Drizzle query failure", () => {
    expect(isDatabaseError(new DrizzleQueryError("select 1", [], new Error("nope")))).toBe(true);
  });

  it("recognises a driver connection failure nested as a cause", () => {
    const err = new Error("wrapped", {
      cause: Object.assign(new Error("write CONNECTION_CLOSED"), { code: "CONNECTION_CLOSED" }),
    });
    expect(isDatabaseError(err)).toBe(true);
  });

  it("recognises a server-side Postgres error by its severity", () => {
    expect(isDatabaseError(Object.assign(new Error("boom"), { severity: "ERROR" }))).toBe(true);
  });

  it("leaves application errors alone, so they still answer 4xx", () => {
    expect(isDatabaseError(new Error("Script not found in bundle"))).toBe(false);
    // A "code" that isn't a connection code must not trip the guard — plenty of
    // application errors carry one.
    expect(isDatabaseError(Object.assign(new Error("nope"), { code: "ENOENT" }))).toBe(false);
    expect(isDatabaseError(undefined)).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isDatabaseError(a)).toBe(false);
  });
});
