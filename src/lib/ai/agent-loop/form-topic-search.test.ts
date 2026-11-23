import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pau, 21 Nov 2026 (FORM_TOPIC_SEARCH_ENABLED): find_past_forms with a topic and no employee searches the saved text of
 * every form this manager may see in Form Monitoring, and nothing wider. The read and the visibility filter are faked
 * here (the replay harness's actor sees every row): the database returns forms at two salons, and the visibility filter
 * keeps this manager's salon only. The saved values are read from a fake table, so a form outside the scope is shown
 * never to be read at all. Invented names only.
 */
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  values: [] as Record<string, unknown>[],
  valuesRead: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  const store = { form_instances: [], form_instance_values: db.values, form_instance_events: [], form_template_versions: [] };
  return {
    getSupabaseAdmin: () => {
      const client = fakeSupabase(store as never);
      return {
        from: (table: string) => {
          const query = client.from(table) as unknown as { in: (column: string, values: unknown[]) => unknown };
          if (table === "form_instance_values") {
            const original = query.in.bind(query);
            query.in = (column: string, values: unknown[]) => {
              if (column === "instance_id") db.valuesRead.push(...(values as string[]));
              return original(column, values);
            };
          }
          return query;
        },
      };
    },
  };
});
vi.mock("@/lib/forms/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/instances")>()),
  listInstances: async () => db.rows,
}));
vi.mock("@/lib/forms/instance-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/instance-scope")>()),
  visibleInstances: <T extends { locationId?: string | null }>(_actor: unknown, rows: T[]) => rows.filter((row) => row.locationId === "loc-0309"),
  instanceListFilterFor: () => ({}),
}));
vi.mock("@/lib/forms/chat-form-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/chat-form-records")>()),
  chatFormsActor: async () => ({ id: "manager-1", role: "salon_director", verified: true, scope: null, visibility: null }),
}));

const { findPastForms } = await import("./tools");

let n = 0;
function form(employee: string, salon: string, values: Record<string, string>, checked: Record<string, string[]> = {}, extra: Record<string, unknown> = {}) {
  n += 1;
  const id = `inst-${n}`;
  db.rows.push({ id, templateName: "Corrective Action Form", templateKey: "dpoa", employeeName: employee, status: "finalized", formDate: `2026-11-${String(10 + (n % 10)).padStart(2, "0")}`, locationId: salon, locationName: salon === "loc-0309" ? "NE Kearney" : "NE Grand Island", archivedAt: null, createdAt: "2026-11-10T15:00:00Z", ...extra });
  for (const [key, value] of Object.entries(values)) db.values.push({ instance_id: id, field_key: key, value, checked: [] });
  for (const [key, ticks] of Object.entries(checked)) db.values.push({ instance_id: id, field_key: key, value: null, checked: ticks });
  return id;
}

const ask = (said: string) =>
  ({
    actor: { subject: "manager-1", role: "salon_director", scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } },
    question: said,
    questionMessageId: "m1",
    history: [],
    today: "2026-11-21",
  }) as never;
const evidence = (said: string) => ({ message_id: "m1", quote: said });

type Out = { forms?: { employee: string; policy: string | null; level: string | null; instance_id: string }[]; counts?: { total: number; people: number; by_form: Record<string, number> }; listed?: number; of?: number; note?: string; reason_code?: string; error?: string };

beforeEach(() => {
  db.rows.length = 0;
  db.values.length = 0;
  db.valuesRead.length = 0;
  n = 0;
  vi.stubEnv("FORM_TOPIC_SEARCH_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("find_past_forms by topic (Pau, 21 Nov 2026)", () => {
  it('"any forms about cash handling at my salons this month?": the matching form at this salon, never another salon\'s, whose text is never even read', async () => {
    const mine = form("Remy Calder", "loc-0309", { observation: "Left the cash drawer open; poor cash handling at close.", policy_violated: "Cash Handling" }, { offense_type: ["standards_of_conduct"], warning_type: ["written"] });
    form("Odalys Frewen", "loc-0309", { observation: "Late to open on 11/12." }, { offense_type: ["attendance_policy"] });
    const theirs = form("Quill Fenwick", "loc-0307", { observation: "Cash handling: drawer short." });
    const said = "any forms about cash handling at my salons this month?";
    const out = (await findPastForms(ask(said), { about: "cash handling", date_from: "2026-11-01", date_to: "2026-11-21", forms_on_file_evidence: evidence(said) })) as Out;
    expect(out.forms?.map((entry) => entry.instance_id), JSON.stringify(out)).toEqual([mine]);
    expect(out.forms?.[0]).toMatchObject({ employee: "Remy", policy: "Cash Handling", level: "Written Warning" });
    expect(out.counts).toEqual({ total: 1, people: 1, by_form: { "Corrective Action Form": 1 } });
    expect(db.valuesRead, "another salon's form text was read").not.toContain(theirs);
  });

  it('"who\'s been written up for dress code?": the ticked Dress Code offense is the topic, counted by code', async () => {
    form("Remy Calder", "loc-0309", { observation: "Wore a hoodie on shift." }, { offense_type: ["dress_code"], warning_type: ["verbal"] });
    form("Remy Calder", "loc-0309", { observation: "Hoodie again, dress code." }, { offense_type: ["dress_code"], warning_type: ["written"] });
    form("Odalys Frewen", "loc-0309", { observation: "Wore jeans with holes." }, { offense_type: ["dress_code"] });
    form("Tamsin Okafor", "loc-0309", { observation: "Late to open." }, { offense_type: ["attendance_policy"] });
    const said = "who's been written up for dress code?";
    const out = (await findPastForms(ask(said), { about: "dress code", form: "CA", forms_on_file_evidence: evidence(said) })) as Out;
    expect(out.counts).toEqual({ total: 3, people: 2, by_form: { "Corrective Action Form": 3 } });
    expect(out.forms?.map((entry) => entry.employee).sort()).toEqual(["Odalys", "Remy", "Remy"]);
    expect(out.forms?.find((entry) => entry.level === "Verbal Warning")?.policy).toBe("Dress code");
  });

  it("capped with an honest N of M; the counts are over every match", async () => {
    for (let k = 0; k < 30; k += 1) form(`Person${k} Sample`, "loc-0309", { observation: "Dress code: no name tag." });
    const said = "who's been written up for dress code?";
    const out = (await findPastForms(ask(said), { about: "dress code", forms_on_file_evidence: evidence(said) })) as Out;
    expect([out.listed, out.of, out.counts?.total]).toEqual([25, 30, 30]);
    expect(out.note).toMatch(/Showing 25 of 30/);
  });

  it("only when the manager's own words ask about forms on file", async () => {
    form("Remy Calder", "loc-0309", { observation: "Dress code." });
    const out = (await findPastForms(ask("she wore a hoodie again"), { about: "dress code", forms_on_file_evidence: evidence("dress code forms") })) as Out;
    expect(out.reason_code, JSON.stringify(out)).toMatch(/privacy/);
    expect(db.valuesRead).toEqual([]);
  });

  it("off (production today): a topic alone is refused plainly, and nothing is read", async () => {
    vi.stubEnv("FORM_TOPIC_SEARCH_ENABLED", "");
    form("Remy Calder", "loc-0309", { observation: "Dress code." });
    const said = "who's been written up for dress code?";
    const out = (await findPastForms(ask(said), { about: "dress code", forms_on_file_evidence: evidence(said) })) as Out;
    expect(out.reason_code).toBe("topic_search_off");
    expect(db.valuesRead).toEqual([]);
  });
});
