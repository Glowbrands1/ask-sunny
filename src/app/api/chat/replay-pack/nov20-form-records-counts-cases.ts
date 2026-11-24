import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE CHAT'S FORMS ON FILE BLOCK CARRIES CODE-BUILT COUNTS (FORMS_ON_FILE_COUNTS_ENABLED; QA's f081 follow-up)
 * ============================================================================
 *
 * QA's f081 (20 Nov 2026, production 121c67ab): "show me CA and coaching forms for <A> this month" listed "11/19/2026 —
 * draft (6)" (another person's form folded in) and a total its lines did not add up to; "list ca for the month" said
 * "11/18 — <A> (×2)" (3) and "11/20 … 1" (2). #1181 fixed the agent loop; this chat's own FORMS ON FILE block
 * (`forms/chat-form-records.ts`, every manager not on the loop, and Ask Bubbles) had the model count the rows too. On: the
 * block carries COUNTS built by code (per person as filed, per form, per date, a total). The invariant is on the
 * block given to the model. Invented names: Avery Avebury, and Avery Av (a different person).
 *
 * CHANGED ON PURPOSE (Pau, 23 Nov 2026: "the archived should not be acknowledged as a form, all just should be finalized or
 * drafted"): archiving is removed, so QA's ruling that left archived drafts out and marked archived finalized forms is gone.
 * Every form counts under its own status, as Form Monitoring shows them: Avery Avebury has 19 this month, and the fixture's
 * `archived_at` (what production holds until the unarchive migration runs) is ignored.
 *
 * WORDING (QA, same day): with the flag off, QA's own wordings never reach the block on this path. "show me CA and
 * coaching forms for <A> this month" is read as opening one of them (`forms/chat-reopen.ts`, its which-one list of the
 * person's active forms), and "list ca for the month" as a request to make a CA ("Who is this form for?"). With the flag,
 * a list question (`isFormListQuestion`: list / show me / how many / who got, a kind of form, a period or plural form
 * words, no open or make word) reaches the block and never the reopen flow or a new form. Cases with QA's exact wordings
 * and with the block's other records wordings.
 */

const FLAG = "FORMS_ON_FILE_COUNTS_ENABLED";
const REPORT = "QA's f081 follow-up (20 Nov 2026): the chat's FORMS ON FILE block left counting to the model";

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

function onFile(t: ReplayContext): void {
  const forms = t.forms() as Record<string, unknown>[];
  let n = 0;
  const put = (date: string, status: string, archived: boolean, employee = "Avery Avebury") => {
    n += 1;
    forms.push({
      id: `f081-chat-${n}`,
      template_id: "t",
      template_version_id: "v",
      variant_key: null,
      employee_role: null,
      location_id: KEARNEY.primaryAreaId,
      location_name: "NE Kearney",
      created_by: "another-manager",
      created_by_role: "salon_director",
      source: "ask_sunny",
      status,
      follow_up_date: null,
      archived_at: archived ? `${date}T23:00:00Z` : null,
      revises_instance_id: null,
      template_key: "dpoa",
      template_name: "Corrective Action Form",
      employee_name: employee,
      form_date: date,
      created_at: `${date}T${String(10 + (n % 10)).padStart(2, "0")}:00:00Z`,
      updated_at: `${date}T10:00:00Z`,
    });
  };
  for (const [date, live, archivedDrafts, archivedFinal] of NOVEMBER) {
    for (let k = 0; k < live; k += 1) put(date, "draft", false);
    for (let k = 0; k < archivedDrafts; k += 1) put(date, "draft", true);
    for (let k = 0; k < archivedFinal; k += 1) put(date, "finalized", true);
  }
  put("2026-11-19", "draft", true, "Avery Av");
}

const counted = (said: string, check: (block: string) => void): ReplayCase["run"] => async (t) => {
  vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  onFile(t);
  t.modelSays("Here are the forms on file.");
  await t.thread().say(said);
  check(t.lastFormRecords?.() ?? "");
};

export const NOV20_FORM_RECORDS_COUNTS_CASES: ReplayCase[] = [
  {
    id: "nov20-f081-chat-b-person-month-counts",
    title: "(b) on this path: \"does Avery Avebury have any CAs this month?\": the block's COUNTS give Avery Avebury 19 (18 drafts and the finalized CA of 11/10), 11/18: 3, 11/19: 5, 11/20: 2; nothing called archived, and Avery Av's form counted as his own (never folded into Avery Avebury's)",
    report: REPORT,
    // Off in production: the block lists Avery Av's form among Avery Avebury's and leaves the counting to the model.
    status: { open: "FORMS_ON_FILE_COUNTS_ENABLED is off in production (QA turns it on after a live test)" },
    fixFlags: [FLAG, "FORMS_ON_FILE_DATE_RANGE_ENABLED"],
    run: counted("does Avery Avebury have any CAs this month?", (block) => {
      expect(block, block).toMatch(/COUNTS \(code counted every form the read found: 20\)/);
      expect(block).toContain("- Avery Avebury: 19 — Corrective Action Form 19 (2026-11-05: 1, draft 1; 2026-11-09: 1, draft 1; 2026-11-10: 1, finalized 1; 2026-11-12: 1, draft 1; 2026-11-14: 2, draft 2; 2026-11-16: 3, draft 3; 2026-11-18: 3, draft 3; 2026-11-19: 5, draft 5; 2026-11-20: 2, draft 2)");
      expect(block).toMatch(/- Avery Av: 1 — /);
      expect(block).not.toMatch(/archiv/i);
    }),
  },
  {
    id: "nov20-f081-chat-c-month-list-counts",
    title: "(c) on this path: \"who got a CA this month?\": the block's COUNTS give Avery Avebury 11/18: 3, 11/19: 5 and 11/20: 2 with the finalized CA of 11/10, Avery Av's form counted as his own, nothing called archived, and the list is complete (never \"stops at 100\")",
    report: REPORT,
    // Off in production: the block lists Avery Av's form among Avery Avebury's and leaves the counting to the model.
    status: { open: "FORMS_ON_FILE_COUNTS_ENABLED is off in production (QA turns it on after a live test)" },
    fixFlags: [FLAG, "FORMS_ON_FILE_DATE_RANGE_ENABLED"],
    run: counted("who got a CA this month?", (block) => {
      expect(block, block).toMatch(/- Avery Avebury: 19 — /);
      expect(block).toMatch(/2026-11-18: 3, draft 3/);
      expect(block).toMatch(/2026-11-20: 2, draft 2/);
      expect(block).toMatch(/2026-11-10: 1, finalized 1/);
      expect(block).toMatch(/- Avery Av: 1 — /);
      expect(block).not.toMatch(/archiv/i);
      expect(block).not.toMatch(/stops at 100/);
    }),
  },
  {
    id: "nov20-f081-chat-qa-b-show-me-forms-is-a-list",
    title: "QA's (b) on this path: \"show me CA and coaching forms for Avery Avebury this month\" reaches FORMS ON FILE (never the open-which-one flow): COUNTS give Avery Avebury 19, the finalized CA of 11/10 under finalized, nothing called archived, Avery Av's own form counted separately",
    report: REPORT,
    status: { open: "FORMS_ON_FILE_COUNTS_ENABLED is off in production: this wording goes to the open-which-one flow" },
    fixFlags: [FLAG, "FORMS_ON_FILE_DATE_RANGE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      onFile(t);
      t.modelSays("Here are the forms on file.");
      const reply = await t.thread().say("show me CA and coaching forms for Avery Avebury this month");
      expect(reply.content, "the open-which-one flow answered").not.toMatch(/Which one should I open/);
      const block = t.lastFormRecords?.() ?? "";
      expect(block, block).toMatch(/- Avery Avebury: 19 — /);
      expect(block).toMatch(/2026-11-10: 1, finalized 1/);
      expect(block).toMatch(/- Avery Av: 1 — /);
      expect(block).not.toMatch(/archiv/i);
    },
  },
  {
    id: "nov20-f081-chat-qa-c-list-ca-never-a-new-form",
    title: "QA's (c) on this path: \"list ca for the month\" never starts a new CA (no \"Who is this form for?\", no card): it reaches FORMS ON FILE with this month's counts (Avery Avebury 11/18: 3, 11/20: 2)",
    report: REPORT,
    status: { open: "FORMS_ON_FILE_COUNTS_ENABLED is off in production: this wording starts a new CA" },
    fixFlags: [FLAG, "FORMS_ON_FILE_DATE_RANGE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      onFile(t);
      t.modelSays("Here are the forms on file.");
      const reply = await t.thread().say("list ca for the month");
      expect(reply.content, "a new CA was started").not.toMatch(/Who is this form for/);
      expect(reply.formProposal ?? null, "a card was proposed").toBeNull();
      const block = t.lastFormRecords?.() ?? "";
      expect(block, block).toMatch(/- Avery Avebury: 19 — /);
      expect(block).toMatch(/2026-11-18: 3, draft 3/);
      expect(block).toMatch(/2026-11-20: 2, draft 2/);
    },
  },
];
