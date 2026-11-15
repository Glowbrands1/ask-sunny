import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * QA's review of #1013 (15 Nov 2026): findRecentAssistantDraft compared exact names, so a card for "Lorraine Fairweather"
 * pressed again made a second draft beside the one saved as "Rae Fairweather" (preferred Rae). With
 * READABLE_NAMES_ENABLED the same roster person under the other name is the same draft. Invented names.
 */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
/** The tables read, in order: form_instance_events is read only when a draft for this person is found. */
const reads: string[] = [];

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  private rows() {
    return (tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)));
  }
  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    reads.push(this.table);
    return Promise.resolve(resolve({ data: this.rows(), error: null }));
  }
}

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from: (table: string) => new Query(table) }) }));

const PROPOSAL = "prop_0123456789abcdef";

async function find(employeeName: string) {
  reads.length = 0;
  const instances = await import("./instances");
  await instances.findRecentAssistantDraft({ templateKey: "dpoa", employeeName, createdBy: "me", locationId: "loc-0309", proposalId: PROPOSAL, now: new Date("2026-11-15T00:00:00Z") }).catch(() => null);
  return reads.includes("form_instance_events");
}

describe("findRecentAssistantDraft and the person's other name", () => {
  afterEach(async () => {
    (await import("./preferred-name-shown")).installPreferredAliases(() => undefined);
    vi.unstubAllEnvs();
  });

  function seed(savedAs: string) {
    tables.form_templates = [{ id: "t-dpoa", key: "dpoa" }];
    tables.form_instances = [{ id: "d-1", template_id: "t-dpoa", created_by: "me", source: "ask_sunny", status: "draft", employee_name: savedAs, location_id: "loc-0309", created_at: "2026-11-14T20:00:00Z" }];
    tables.form_instance_events = [{ instance_id: "d-1", kind: "created", detail: { proposalId: PROPOSAL } }];
  }

  it("with the flag, the draft saved as Rae Fairweather is Lorraine Fairweather's", async () => {
    vi.stubEnv("READABLE_NAMES_ENABLED", "true");
    (await import("./preferred-name-shown")).installPreferredAliases(() => [{ legal: "Lorraine Fairweather", preferred: "Rae Fairweather" }]);
    seed("Rae Fairweather");
    expect(await find("Lorraine Fairweather")).toBe(true);
  });

  it("off: an exact name only, as before", async () => {
    (await import("./preferred-name-shown")).installPreferredAliases(() => [{ legal: "Lorraine Fairweather", preferred: "Rae Fairweather" }]);
    seed("Rae Fairweather");
    expect(await find("Lorraine Fairweather")).toBe(false);
  });
});
