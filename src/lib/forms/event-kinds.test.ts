import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * EVERY EVENT KIND THE CODE WRITES IS ONE THE DATABASE ACCEPTS.
 *
 * `form_instance_events.kind` is the `form_event_kind` enum, and the in-memory
 * fake the forms suite runs on accepts any string. So a new kind — found in a
 * run against a real Postgres, as "invalid input value for enum
 * form_event_kind" — passed every test and failed the first real request.
 * This reads the enum from the migrations and the kinds from the code.
 */
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

function enumValues(): Set<string> {
  const values = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const created = /create type public\.form_event_kind as enum \(([\s\S]*?)\);/.exec(sql);
    for (const match of (created?.[1] ?? "").matchAll(/'([a-z_]+)'/g)) values.add(match[1]!);
    for (const match of sql.matchAll(/alter type public\.form_event_kind add value (?:if not exists )?'([a-z_]+)'/g)) {
      values.add(match[1]!);
    }
  }
  return values;
}

describe("form event kinds", () => {
  it("are all values of the form_event_kind enum", () => {
    const allowed = enumValues();
    expect(allowed.has("created")).toBe(true);
    const source = readFileSync(join(process.cwd(), "src/lib/forms/instances.ts"), "utf8");
    const written = [...source.matchAll(/recordEvent\(\s*[^,]+,\s*"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(written.length).toBeGreaterThan(5);
    expect(written.filter((kind) => !allowed.has(kind))).toEqual([]);
  });
});
