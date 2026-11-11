import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isDemoMode } from "@/lib/config/runtime";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { demoReportingTables, type DemoRow } from "./fixtures";

/**
 * ============================================================================
 * THE REPORTING READ CLIENT — LIVE SUPABASE, OR THE DEMO TABLES
 * ============================================================================
 *
 * Outside demo mode this is exactly `getSupabaseAdmin()`, so the live path is
 * unchanged. In demo mode it is an in-memory client serving the invented rows
 * in `./fixtures.ts` through the same query calls the read layer makes, so the
 * reporting pages run their real resolver and builders on demo data.
 *
 * Read-only by construction: the fake implements the read operators the read
 * layer uses and throws on anything else, so a write can never "succeed"
 * against it.
 */
export function reportingReadClient(): SupabaseClient {
  return isDemoMode() ? demoReportingClient() : getSupabaseAdmin();
}

/** Whether the reporting pages can read data in this runtime. */
export function reportingReadsConfigured(): boolean {
  if (isDemoMode()) return true;
  return Boolean(process.env[SUPABASE_URL_ENV]) && supabaseSecretKeyConfigured();
}

/* ------------------------------------------------------------ the fake */

function read(row: DemoRow, column: string): unknown {
  if (!column.includes(".")) return row[column];
  const [table, field] = column.split(".");
  const nested = row[table] as DemoRow | null | undefined;
  return nested ? nested[field] : undefined;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/** Splits a PostgREST `or` list on commas outside parentheses. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** Supports `col.eq.value` and `col.in.("a","b")`, the forms the read layer writes. */
function orPredicate(expression: string): (row: DemoRow) => boolean {
  const clauses = splitTopLevel(expression).map((clause) => {
    const match = /^([a-z_.]+)\.(eq|in)\.(.*)$/.exec(clause.trim());
    if (!match) throw new Error(`Demo reporting client: unsupported or clause ${clause}`);
    const [, column, op, raw] = match;
    if (op === "eq") return (row: DemoRow) => String(read(row, column)) === raw;
    const values = raw
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""))
      .filter((value) => value.length > 0);
    return (row: DemoRow) => values.includes(String(read(row, column)));
  });
  return (row) => clauses.some((keep) => keep(row));
}

function demoTable(rows: readonly DemoRow[]) {
  const filters: ((row: DemoRow) => boolean)[] = [];
  const orders: { column: string; ascending: boolean }[] = [];
  let take: number | null = null;

  const run = () => {
    const matched = rows.filter((row) => filters.every((keep) => keep(row)));
    const ordered =
      orders.length === 0
        ? matched
        : [...matched].sort((a, b) => {
            for (const { column, ascending } of orders) {
              const result = compare(read(a, column), read(b, column));
              if (result !== 0) return ascending ? result : -result;
            }
            return 0;
          });
    // Copies, so a caller cannot mutate the shared fixture.
    const data = (take === null ? ordered : ordered.slice(0, take)).map((row) => ({ ...row }));
    return { data, error: null };
  };

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => read(row, column) === value);
      return builder;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => (read(row, column) ?? null) === value);
      return builder;
    },
    in: (column: string, values: readonly unknown[]) => {
      filters.push((row) => values.includes(read(row, column)));
      return builder;
    },
    or: (expression: string) => {
      filters.push(orPredicate(expression));
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending !== false });
      return builder;
    },
    limit: (count: number) => {
      take = count;
      return builder;
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(run()));
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
      }
    },
  };
  return builder;
}

let client: SupabaseClient | null = null;

export function demoReportingClient(): SupabaseClient {
  if (client) return client;
  const tables = demoReportingTables();
  const fake = {
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`Demo reporting client: no demo table ${table}`);
      return demoTable(rows);
    },
  };
  client = fake as unknown as SupabaseClient;
  return client;
}
