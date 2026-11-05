import { describe, expect, it } from "vitest";
import {
  type ExportTable,
  exportTables,
  findSchemaDrift,
  insertStatement,
  loadScript,
  oversizedStatements,
  toSqlLiteral,
} from "./neon-export";

const tables = exportTables();
const table = (name: string): ExportTable => {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`no table ${name}`);
  return found;
};
const column = (tableName: string, name: string) => {
  const found = table(tableName).columns.find((c) => c.name === name);
  if (!found) throw new Error(`no column ${name}`);
  return found.column;
};

describe("exportTables", () => {
  it("covers every table in the schema", () => {
    expect(tables.length).toBeGreaterThanOrEqual(38);
    expect(tables.map((t) => t.name)).toContain("skill_versions");
  });

  it("skips generated columns", () => {
    const names = table("agent_memory").columns.map((c) => c.name);
    expect(names).toContain("user_id");
    expect(names).not.toContain("user_scope");
  });
});

describe("toSqlLiteral", () => {
  it("turns timestamps into epoch milliseconds", () => {
    const col = column("users", "created_at");
    expect(toSqlLiteral(col, new Date("2026-01-02T03:04:05.678Z"))).toBe("1767323045678");
  });

  it("refuses a timestamp it can't read rather than storing garbage", () => {
    expect(() => toSqlLiteral(column("users", "created_at"), "not a date")).toThrow(
      "Bad timestamp",
    );
  });

  it("turns booleans into 0 and 1, including false", () => {
    const col = column("users", "email_verified");
    expect(toSqlLiteral(col, true)).toBe("1");
    expect(toSqlLiteral(col, false)).toBe("0");
  });

  it("stores jsonb as JSON text and escapes it", () => {
    const col = column("registry_entries", "tags");
    expect(toSqlLiteral(col, ["it's", "b"])).toBe(`'["it''s","b"]'`);
  });

  it("escapes quotes and keeps other text intact", () => {
    const col = column("skills", "description");
    expect(toSqlLiteral(col, "O'Brien; DROP TABLE skills;--")).toBe(
      "'O''Brien; DROP TABLE skills;--'",
    );
  });

  it("keeps null as NULL for every column kind", () => {
    expect(toSqlLiteral(column("users", "created_at"), null)).toBe("NULL");
    expect(toSqlLiteral(column("registry_entries", "tags"), null)).toBe("NULL");
    expect(toSqlLiteral(column("skills", "description"), null)).toBe("NULL");
  });

  it("keeps zero", () => {
    expect(toSqlLiteral(column("registry_entries", "stars"), 0)).toBe("0");
  });
});

describe("insertStatement", () => {
  it("binds every stored column in order", () => {
    const sql = insertStatement(table("agent_memory"), {
      id: "1",
      org_id: "o",
      user_id: null,
      key: "k",
      value: "v",
      created_at: new Date(0),
      updated_at: new Date(1),
    });
    expect(sql).toContain(`INSERT INTO "agent_memory"`);
    expect(sql).not.toContain("user_scope");
    expect(sql).toContain("'1', 'o', NULL, 'k', 'v', 0, 1");
  });
});

describe("findSchemaDrift", () => {
  const neonMatching = () =>
    Object.fromEntries(tables.map((t) => [t.name, t.columns.map((c) => c.name)]));

  it("passes when the schemas match", () => {
    expect(findSchemaDrift(tables, neonMatching())).toEqual([]);
  });

  it("refuses a Neon column D1 would drop", () => {
    const neon = neonMatching();
    neon.skills = [...(neon.skills ?? []), "legacy_notes"];
    expect(findSchemaDrift(tables, neon)).toEqual([
      'Neon column "skills.legacy_notes" is not in D1',
    ]);
  });

  it("refuses a Neon table D1 would drop", () => {
    expect(findSchemaDrift(tables, { ...neonMatching(), orphan: ["id"] })).toEqual([
      'Neon table "orphan" is not in the D1 schema',
    ]);
  });

  it("refuses a table missing from Neon", () => {
    const neon = neonMatching();
    delete neon.users;
    expect(findSchemaDrift(tables, neon)).toEqual(['D1 table "users" is not in Neon']);
  });
});

describe("loadScript", () => {
  it("never deletes, so a repeat load can't wipe live data", () => {
    const sql = loadScript([`INSERT INTO "users" ("id") VALUES ('1');`]);
    expect(sql).not.toMatch(/DELETE|DROP|TRUNCATE/i);
    expect(sql.startsWith("PRAGMA defer_foreign_keys = true;")).toBe(true);
  });
});

describe("oversizedStatements", () => {
  it("flags only statements near D1's limit, counting bytes rather than characters", () => {
    expect(oversizedStatements(["small", "x".repeat(50_000)])).toEqual([]);
    expect(oversizedStatements(["x".repeat(100_000)])).toEqual([100_000]);
    expect(oversizedStatements(["é".repeat(50_000)])).toEqual([100_000]);
  });
});
