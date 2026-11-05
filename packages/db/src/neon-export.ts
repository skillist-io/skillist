import { getTableColumns, getTableName, is } from "drizzle-orm";
import { type SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

/**
 * Turns Postgres rows into D1 INSERTs for the one-time Neon → D1 move.
 *
 * Driven by the schema rather than a hand-kept list, so a table or column can't
 * be forgotten: each value is converted by what its D1 column stores.
 */

export type ExportTable = {
  name: string;
  /** Stored columns only: a generated column can't be inserted into. */
  columns: { name: string; column: SQLiteColumn }[];
};

export function exportTables(): ExportTable[] {
  // The module also exports plain enum arrays, so widen before filtering to tables.
  return (Object.values(schema) as unknown[])
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => ({
      name: getTableName(table),
      columns: Object.values(getTableColumns(table))
        .filter((column) => !column.generated)
        .map((column) => ({ name: column.name, column: column as SQLiteColumn })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** One Postgres value as a SQLite literal, shaped for the D1 column it lands in. */
export function toSqlLiteral(column: SQLiteColumn, value: unknown): string {
  if (value === null || value === undefined) return "NULL";

  switch (column.columnType) {
    case "SQLiteTimestamp": {
      const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
      if (Number.isNaN(ms)) throw new Error(`Bad timestamp in ${column.name}: ${String(value)}`);
      return String(ms);
    }
    case "SQLiteBoolean":
      return value ? "1" : "0";
    case "SQLiteTextJson":
      return quote(JSON.stringify(value));
    default:
      if (typeof value === "number") return String(value);
      if (typeof value === "string") return quote(value);
      throw new Error(`Unexpected ${typeof value} in ${column.name}`);
  }
}

export function insertStatement(table: ExportTable, row: Record<string, unknown>): string {
  const names = table.columns.map((c) => `"${c.name}"`).join(", ");
  const values = table.columns.map((c) => toSqlLiteral(c.column, row[c.name])).join(", ");
  return `INSERT INTO "${table.name}" (${names}) VALUES (${values});`;
}

/** D1's documented statement limit is 100 KB; leave room for the driver. */
const MAX_STATEMENT_BYTES = 90 * 1024;

/**
 * The load file. Deliberately no DELETE: loading over existing rows fails on a
 * primary key conflict rather than replacing them, so running this after go-live
 * can't wipe live data. A rehearsal has to start from an empty database.
 */
export function loadScript(statements: readonly string[]): string {
  // Foreign keys are checked at commit, so tables load in any order and
  // self-references (a version's parent) don't need sorting.
  return `PRAGMA defer_foreign_keys = true;\n${statements.join("\n")}\n`;
}

/** Statements that may exceed D1's limit, so a failed load isn't the first sign. */
export function oversizedStatements(statements: readonly string[]): number[] {
  const encoder = new TextEncoder();
  return statements
    .map((statement) => encoder.encode(statement).byteLength)
    .filter((bytes) => bytes > MAX_STATEMENT_BYTES);
}

/**
 * Differences that would lose data if ignored. A Neon column or table the D1
 * schema doesn't have would be dropped silently, so the export refuses instead.
 */
export function findSchemaDrift(
  tables: readonly ExportTable[],
  neon: Record<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  const known = new Map(tables.map((t) => [t.name, t]));
  for (const [name, columns] of Object.entries(neon)) {
    const table = known.get(name);
    if (!table) {
      problems.push(`Neon table "${name}" is not in the D1 schema`);
      continue;
    }
    const stored = new Set(table.columns.map((c) => c.name));
    for (const column of columns) {
      if (!stored.has(column)) problems.push(`Neon column "${name}.${column}" is not in D1`);
    }
  }
  for (const table of tables) {
    const columns = neon[table.name];
    if (!columns) {
      problems.push(`D1 table "${table.name}" is not in Neon`);
      continue;
    }
    for (const { name, column } of table.columns) {
      if (!columns.includes(name) && column.notNull && !column.hasDefault) {
        problems.push(`D1 column "${table.name}.${name}" is required but not in Neon`);
      }
    }
  }
  return problems;
}
