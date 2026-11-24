import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FORMS ON FILE ARE COUNTED BY CODE; ANOTHER PERSON NEVER COUNTS (QA's f081, 20 Nov 2026)
 * ============================================================================
 *
 * Production main 121c67ab, an admin's chats. November's Corrective Actions for one person: 19, of which 11 archived, on 9
 * dates (11/18: 3 drafts; 11/19: 5, 2 of them archived; 11/20: 2, 1 archived), and one more on 11/19 for a DIFFERENT
 * person whose name starts the same ("<A> Te", archived).
 * - "show me CA and coaching forms for <A> this month" listed "11/19/2026 — draft (6)" (the other person's form folded in),
 *   a total of 19 that its own lines did not add up to, and archived forms as if on file.
 * - "list ca for the month" said "11/18 — <A> (×2)" (3), "11/20 … 1" (2), and "The list stops at 100 forms".
 * General rule: find_past_forms returns the counts itself, per person (the name as filed, never merged with another),
 * per form, per date, with statuses, and a total; the reply copies them. The month is read
 * past 100 and counted over every row. Invented names only: Avery Avebury (<A>) and Avery Av (the other person).
 *
 * CHANGED ON PURPOSE (Pau, 23 Nov 2026: "the archived should not be acknowledged as a form, all just should be finalized or
 * drafted"): archiving is removed. QA's ruling that left archived drafts out and marked archived finalized forms is gone: every
 * form counts under its own status (draft or finalized), as Form Monitoring shows them, so Avery Avebury has 19 this month and
 * Avery Av's form counts as his own. The fixture still sets `archived_at` on the rows the old flag marked (what production's
 * data holds until the unarchive migration runs) to prove the readers ignore it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f081 (20 Nov 2026, production 121c67ab): forms-on-file lists miscounted, another person folded in, archived listed";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const AVERY: DirectoryRow = { id: "e-avery-avebury", firstName: "Avery", lastName: "Avebury", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** QA's November: [date, drafts, drafts the old flag marked archived, finalized the old flag marked archived] for Avery Avebury's CAs. */
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
type Out = { counts?: Counts; forms?: { employee?: string; status?: string }[]; complete?: boolean; note?: string };

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
  fixed("nov20-f081-b-person-month-counts", "(b) \"show me CA and coaching forms for Avery Avebury this month\" (CA and coaching asked in one step, as live): the CA result's counts are all 19 of Avery Avebury's, each under draft or finalized (11/19: 5 drafts, 11/20: 2, 11/10: 1 finalized), no archived bucket or mark, and never Avery Av's form", async (t) => {
    const seen: Out[] = [];
    const said = "show me CA and coaching forms for Avery Avebury this month";
    t.loopModel!(liveModel([{ employee_name: "Avery Avebury", form: "CA", ...MONTH }, { employee_name: "Avery Avebury", form: "coaching", ...MONTH }], said, seen));
    await t.thread().say(said);
    const ca = seen[0];
    expect(ca?.counts?.total, JSON.stringify(ca?.counts)).toBe(19);
    expect(ca?.counts?.by_person.map((person) => person.employee)).toEqual(["Avery Avebury"]);
    expect(byDate(ca?.counts, "Avery Avebury")).toEqual({ "2026-11-05": 1, "2026-11-09": 1, "2026-11-10": 1, "2026-11-12": 1, "2026-11-14": 2, "2026-11-16": 3, "2026-11-18": 3, "2026-11-19": 5, "2026-11-20": 2 });
    expect(JSON.stringify(ca), "an archived bucket or mark").not.toMatch(/archiv/i);
    expect([...new Set((ca?.forms ?? []).map((form) => form.status))].sort()).toEqual(["draft", "finalized"]);
    expect((ca?.forms ?? []).every((form) => form.employee === "Avery Avebury")).toBe(true);
  }),
  fixed("nov20-f081-b-archived-only-when-asked", "(b) asked \"show me all CA forms for Avery Avebury this month including archived\": there is no archived form, so the counts are the same 19, 11/19 is 5 drafts, and nothing is called archived", async (t) => {
    const seen: Out[] = [];
    const said = "show me all CA forms for Avery Avebury this month including archived";
    t.loopModel!(liveModel([{ employee_name: "Avery Avebury", form: "CA", ...MONTH }], said, seen));
    await t.thread().say(said);
    const ca = seen[0];
    expect(ca?.counts?.total, JSON.stringify(ca?.counts)).toBe(19);
    const day = ca?.counts?.by_person[0]?.by_form[0]?.by_date.find((entry) => entry.date === "2026-11-19");
    expect(day, JSON.stringify(ca?.counts)).toEqual({ date: "2026-11-19", count: 5, statuses: { draft: 5 } });
    expect(ca?.counts?.by_person.map((person) => person.employee)).toEqual(["Avery Avebury"]);
    expect(JSON.stringify(ca), "an archived bucket or mark").not.toMatch(/archiv/i);
  }),
  fixed("nov20-f081-c-month-list-counts", "(c) \"list ca for the month\": counts per person and date come from code (Avery Avebury 19: 11/18: 3, 11/19: 5, 11/20: 2, the finalized CA of 11/10; Avery Av's 11/19 form is his own 1), every row counted (complete), never \"stops at 100\", and nothing called archived", async (t) => {
    const seen: Out[] = [];
    const said = "list ca for the month";
    t.loopModel!(liveModel([{ form: "CA", ...MONTH }], said, seen));
    await t.thread().say(said);
    const month = seen[0];
    expect(month?.complete, JSON.stringify(month)).toBe(true);
    expect(month?.counts?.total).toBe(20);
    expect(byDate(month?.counts, "Avery Avebury")).toEqual({ "2026-11-05": 1, "2026-11-09": 1, "2026-11-10": 1, "2026-11-12": 1, "2026-11-14": 2, "2026-11-16": 3, "2026-11-18": 3, "2026-11-19": 5, "2026-11-20": 2 });
    expect(byDate(month?.counts, "Avery Av")).toEqual({ "2026-11-19": 1 });
    expect(JSON.stringify(month), "an archived bucket or mark").not.toMatch(/archiv/i);
    expect(month?.note ?? "").not.toMatch(/stops at 100/);
  }),
  /*
   * Changed on purpose (QA2, 21 Nov 2026, production "list ca for the month": "100 of 121 shown" over 102 rows). This case
   * listed exactly 100 with the cut inside a day; the model then wrote that day from counts.by_date and listed more than
   * it said. Now the 121 are laid out as production's were (the cut falls inside the oldest day) and the list stops at the
   * last whole day: "N of 121" is the rows listed, and the cut day is given as a count only.
   */
  fixed("nov20-f081-c-month-list-over-100", "(c) \"list ca for the month\" with 121 CAs on file this month and the 100th row inside 11/03: all 121 are counted (complete), the list stops at the end of 11/05 (69 of 121) and 11/03's 52 are given as a count only, so the number said to be shown is the rows listed", async (t) => {
    const forms = t.forms() as unknown as Row[];
    // This case is about the 100-row cap, so it keeps its original 121-row layout: the drafts the old archived flag marked are
    // set aside (Pau, 23 Nov 2026: they would now count too).
    const base = forms.find((row) => row.employee_name === "Avery Avebury" && !row.archived_at)!;
    for (const row of [...forms]) if (row.archived_at && row.status === "draft") forms.splice(forms.indexOf(row), 1);
    const more = (date: string, count: number) => {
      for (let k = 0; k < count; k += 1) forms.push({ ...base, id: `f081-more-${date}-${k}`, form_date: date, created_at: `${date}T${String(k % 24).padStart(2, "0")}:00:00Z` });
    };
    more("2026-11-13", 60);
    more("2026-11-03", 52);
    const seen: Out[] = [];
    const said = "list ca for the month";
    t.loopModel!(liveModel([{ form: "CA", ...MONTH }], said, seen));
    await t.thread().say(said);
    const month = seen[0] as Omit<Out, "forms"> & { listed?: number; of?: number; not_listed_days?: { date: string; count: number }[]; forms?: { form_date?: string }[] };
    expect(month?.counts?.total, JSON.stringify({ listed: month?.listed, of: month?.of })).toBe(121);
    expect(month?.complete).toBe(true);
    expect([month?.listed, month?.of], "the list stops at the last whole day").toEqual([69, 121]);
    expect(month?.forms?.length).toBe(month?.listed);
    expect((month?.forms ?? []).some((form) => form.form_date === "2026-11-03"), "a day cut part-way was listed").toBe(false);
    expect(month?.not_listed_days).toEqual([{ date: "2026-11-03", count: 52 }]);
    expect(month?.note ?? "").toContain("the number you say is shown is 69");
  }),
];
