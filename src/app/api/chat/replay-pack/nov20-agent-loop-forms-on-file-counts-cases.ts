import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FORMS ON FILE ARE COUNTED BY CODE; ANOTHER PERSON NEVER COUNTS; ARCHIVED ONLY WHEN ASKED (QA's f081, 20 Nov 2026)
 * ============================================================================
 *
 * Production main 121c67ab, an admin's chats. November's Corrective Actions for one person: 19, of which 11 archived, on 9
 * dates (11/18: 3 drafts; 11/19: 5, 2 of them archived; 11/20: 2, 1 archived), and one more on 11/19 for a DIFFERENT
 * person whose name starts the same ("<A> Te", archived).
 * - "show me CA and coaching forms for <A> this month" listed "11/19/2026 — draft (6)" (the other person's form folded in),
 *   a total of 19 that its own lines did not add up to, and archived forms as if on file.
 * - "list ca for the month" said "11/18 — <A> (×2)" (3), "11/20 … 1" (2), and "The list stops at 100 forms".
 * General rule: find_past_forms returns the counts itself, per person (the name as filed, never merged with another),
 * per form, per date, with statuses, and a total; the reply copies them. QA's ruling on production's data (every archived
 * form with a real name is finalized; archived drafts are test drafts): a finalized form counts whether or not it is
 * archived, marked archived; an archived DRAFT is left out unless the manager asks for archived forms. The month is read
 * past 100 and counted over every row. Invented names only: Avery Avebury (<A>) and Avery Av (the other person).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f081 (20 Nov 2026, production 121c67ab): forms-on-file lists miscounted, another person folded in, archived listed";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const AVERY: DirectoryRow = { id: "e-avery-avebury", firstName: "Avery", lastName: "Avebury", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** QA's November: [date, live drafts, archived drafts, archived finalized] for Avery Avebury's CAs. */
const NOVEMBER: readonly [string, number, number, number][] = [
  ["2026-11-05", 1, 0, 0],
  ["2026-11-09", 0, 1, 0],
  ["2026-11-10", 0, 0, 1],
  ["2026-11-12", 0, 1, 0],
  ["2026-11-14", 0, 2, 0],
  ["2026-11-16", 0, 3, 0],
  ["2026-11-18", 3, 0, 0],
  ["2026-11-19", 3, 2, 0],
  ["2026-11-20", 1, 1, 0],
];

type Row = Record<string, unknown>;

/** One CA made through the app, then its row copied for every form of QA's November (and the other person's one). */
async function seed(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.loopModel!(loopStandIn((view): LoopDecision => (view.results.some((result) => result.tool === "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: AVERY.id, what_happened: "Avery Avebury was late to open.", incident_date: "2026-11-05" } })));
  const setup = t.thread();
  await setup.say("ca for avery avebury, late to open on 11/5");
  const id = await setup.create();
  const forms = t.forms() as unknown as Row[];
  const base = forms.find((row) => row.id === id)!;
  forms.splice(forms.indexOf(base), 1);
  let n = 0;
  const add = (date: string, status: string, archived: boolean, employee = "Avery Avebury") => {
    n += 1;
    forms.push({ ...base, id: `f081-${n}`, employee_name: employee, form_date: date, status, archived_at: archived ? `${date}T23:00:00Z` : null, created_at: `${date}T${String(10 + (n % 10)).padStart(2, "0")}:00:00Z` });
  };
  for (const [date, live, archivedDrafts, archivedFinal] of NOVEMBER) {
    for (let k = 0; k < live; k += 1) add(date, "draft", false);
    for (let k = 0; k < archivedDrafts; k += 1) add(date, "draft", true);
    for (let k = 0; k < archivedFinal; k += 1) add(date, "finalized", true);
  }
  add("2026-11-19", "draft", true, "Avery Av");
  vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));
}

type Counts = { total: number; by_person: { employee: string; total: number; by_form: { form: string; total: number; by_date: { date: string; count: number; statuses: Record<string, number> }[] }[] }[] };
type Out = { counts?: Counts; forms?: { employee?: string; archived?: boolean }[]; complete?: boolean; note?: string; archived?: string };

/** The live model: the calls it made (in one step), with evidence; the results it saw. */
function liveModel(calls: readonly Record<string, unknown>[], quote: string, seen: Out[]) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const results = view.results.filter((result) => result.tool === "find_past_forms");
    if (results.length === 0) return { tools: calls.map((input) => ({ tool: "find_past_forms", input: { ...input, forms_on_file_evidence: evidenceFrom(view, quote) } })) };
    seen.push(...results.map((result) => result.output as Out));
    return { text: "Here's what's on file." };
  });
}

const byDate = (counts: Counts | undefined, employee: string) =>
  Object.fromEntries((counts?.by_person.find((person) => person.employee === employee)?.by_form ?? []).flatMap((form) => form.by_date.map((entry) => [entry.date, entry.count])));

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    t.directory([...STAFF, AVERY]);
    t.as("admin", KEARNEY);
    await seed(t);
    await run(t);
  },
});

const MONTH = { date_from: "2026-11-01", date_to: "2026-11-20" };

export const NOV20_AGENT_LOOP_FORMS_ON_FILE_COUNTS_CASES: ReplayCase[] = [
  fixed("nov20-f081-b-person-month-counts", "(b) \"show me CA and coaching forms for Avery Avebury this month\" (CA and coaching asked in one step, as live): the CA result's counts are Avery Avebury's 9 (8 live drafts and the archived finalized CA of 11/10, marked archived: 11/05: 1, 11/10: 1, 11/18: 3, 11/19: 3, 11/20: 1); no archived draft, and never Avery Av's form", async (t) => {
    const seen: Out[] = [];
    const said = "show me CA and coaching forms for Avery Avebury this month";
    t.loopModel!(liveModel([{ employee_name: "Avery Avebury", form: "CA", ...MONTH }, { employee_name: "Avery Avebury", form: "coaching", ...MONTH }], said, seen));
    await t.thread().say(said);
    const ca = seen[0];
    expect(ca?.counts?.total, JSON.stringify(ca?.counts)).toBe(9);
    expect(ca?.counts?.by_person.map((person) => person.employee)).toEqual(["Avery Avebury"]);
    expect(byDate(ca?.counts, "Avery Avebury")).toEqual({ "2026-11-05": 1, "2026-11-10": 1, "2026-11-18": 3, "2026-11-19": 3, "2026-11-20": 1 });
    const archived = (ca?.forms ?? []).filter((form) => form.archived) as { status?: string }[];
    expect(archived.map((form) => form.status), "the archived finalized CA is listed (marked), and no archived draft").toEqual(["finalized"]);
    expect((ca?.forms ?? []).every((form) => form.employee === "Avery Avebury")).toBe(true);
  }),
  fixed("nov20-f081-b-archived-only-when-asked", "(b) asked with archived forms: \"show me all CA forms for Avery Avebury this month including archived\": the counts are all 19 of Avery Avebury's, 11 of them archived (11/19: 5, 2 archived), each archived form marked, and still never Avery Av's", async (t) => {
    const seen: Out[] = [];
    const said = "show me all CA forms for Avery Avebury this month including archived";
    t.loopModel!(liveModel([{ employee_name: "Avery Avebury", form: "CA", ...MONTH, include_archived: true }], said, seen));
    await t.thread().say(said);
    const ca = seen[0];
    expect(ca?.counts?.total, JSON.stringify(ca?.counts)).toBe(19);
    const day = ca?.counts?.by_person[0]?.by_form[0]?.by_date.find((entry) => entry.date === "2026-11-19");
    expect(day, JSON.stringify(ca?.counts)).toEqual({ date: "2026-11-19", count: 5, statuses: { draft: 3, "draft (archived)": 2 } });
    expect(ca?.counts?.by_person.map((person) => person.employee)).toEqual(["Avery Avebury"]);
  }),
  fixed("nov20-f081-c-month-list-counts", "(c) \"list ca for the month\": counts per person and date come from code (Avery Avebury 11/18: 3, 11/20: 1, and the archived finalized CA of 11/10, marked archived), Avery Av's archived draft left out, every row counted (complete), and never \"stops at 100\"", async (t) => {
    const seen: Out[] = [];
    const said = "list ca for the month";
    t.loopModel!(liveModel([{ form: "CA", ...MONTH }], said, seen));
    await t.thread().say(said);
    const month = seen[0];
    expect(month?.complete, JSON.stringify(month)).toBe(true);
    expect(byDate(month?.counts, "Avery Avebury")).toEqual({ "2026-11-05": 1, "2026-11-10": 1, "2026-11-18": 3, "2026-11-19": 3, "2026-11-20": 1 });
    expect(month?.counts?.by_person.some((person) => person.employee === "Avery Av"), "an archived draft was counted").toBe(false);
    const archived = (month?.forms ?? []).filter((form) => form.archived) as { status?: string; form_date?: string }[];
    expect(archived.map((form) => [form.form_date, form.status]), "the archived finalized CA is listed, marked").toEqual([["2026-11-10", "finalized"]]);
    expect(month?.note ?? "").not.toMatch(/stops at 100/);
  }),
  fixed("nov20-f081-c-month-list-over-100", "(c) \"list ca for the month\" with 121 CAs on file this month: all 121 are counted (complete), 100 are listed and the result says 100 of 121, never a silent \"stops at 100\"", async (t) => {
    const forms = t.forms() as unknown as Row[];
    const base = forms.find((row) => row.employee_name === "Avery Avebury" && !row.archived_at)!;
    for (let k = 0; k < 112; k += 1) forms.push({ ...base, id: `f081-more-${k}`, form_date: "2026-11-15", created_at: `2026-11-15T${String(k % 24).padStart(2, "0")}:00:00Z` });
    const seen: Out[] = [];
    const said = "list ca for the month";
    t.loopModel!(liveModel([{ form: "CA", ...MONTH }], said, seen));
    await t.thread().say(said);
    const month = seen[0] as Out & { listed?: number; of?: number };
    expect(month?.counts?.total, JSON.stringify({ listed: month?.listed, of: month?.of })).toBe(121);
    expect(month?.forms?.length).toBe(100);
    expect([month?.listed, month?.of]).toEqual([100, 121]);
    expect(month?.complete).toBe(true);
  }),
];
