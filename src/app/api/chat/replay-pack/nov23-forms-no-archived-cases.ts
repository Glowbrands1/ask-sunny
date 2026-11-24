import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * NO ARCHIVED FORMS: A FORM IS ONLY DRAFT OR FINALIZED (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * Pau, on Form Monitoring (exact words): "the archived should not be acknowledged as a form, all just should be finalized or
 * drafted." Archiving is removed from the app (no Archived view, badge or Archive / Restore action; the API has no archive
 * verb). What the AI reads follows: a manager asking how many forms are on file gets the same numbers Form Monitoring shows,
 * every form under draft or finalized, with no archived bucket, no "(archived)" mark and no archived draft left out.
 *
 * The fixture still sets `archived_at` on two rows (what production holds until the unarchive migration
 * `20261124001000_forms_unarchive.sql` runs), to prove the readers ignore the old flag. Invented names only.
 *
 * Production's flags: the agent loop is on for every manager (AGENT_LOOP_ENABLED, AGENT_LOOP_USERS "*"), so that case holds
 * today. The chat's own FORMS ON FILE counts block is behind FORMS_ON_FILE_COUNTS_ENABLED (off in production), so that case
 * runs with the fix flags.
 */

const REPORT = "Pau, 23 Nov 2026: \"the archived should not be acknowledged as a form, all just should be finalized or drafted.\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const AVERY: DirectoryRow = { id: "e-avery-avebury", firstName: "Avery", lastName: "Avebury", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** [date, status, employee, flagged by the old archived flag]: 8 forms in November, 5 drafts and 3 finalized. */
const FORMS: readonly [string, "draft" | "finalized", string, boolean][] = [
  ["2026-11-03", "draft", "Avery Avebury", false],
  ["2026-11-05", "finalized", "Avery Avebury", false],
  ["2026-11-09", "draft", "Blair Brandt", false],
  ["2026-11-12", "draft", "Blair Brandt", true],
  ["2026-11-16", "finalized", "Casey Calloway", true],
  ["2026-11-18", "draft", "Casey Calloway", false],
  ["2026-11-19", "finalized", "Dana Dunmore", false],
  ["2026-11-20", "draft", "Dana Dunmore", false],
];

type Row = Record<string, unknown>;
type Counts = { total: number; by_person: { employee: string; total: number; by_form: { by_date: { statuses: Record<string, number> }[] }[] }[] };
type Out = { counts?: Counts; forms?: { status?: string }[]; complete?: boolean };

const QUESTION = "how many forms are on file this month?";

/** The statuses the counts name, however they are split by person and date. */
const statusNames = (counts: Counts | undefined) => [...new Set((counts?.by_person ?? []).flatMap((person) => person.by_form.flatMap((form) => form.by_date.flatMap((day) => Object.keys(day.statuses)))))].sort();

export const NOV23_FORMS_NO_ARCHIVED_CASES: ReplayCase[] = [
  {
    id: "nov23-no-archived-forms-loop-how-many-on-file",
    title: "\"how many forms are on file this month?\" (agent loop, production's flags): counts are 8 forms, 5 draft and 3 finalized, under draft or finalized only: no archived bucket, no archived mark, no form left out for having been archived",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t: ReplayContext) {
      if (!t.loopOn?.() || !offline) return;
      t.directory([...STAFF, AVERY]);
      t.as("admin", KEARNEY);
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
      FORMS.forEach(([date, status, employee, flagged], n) => {
        forms.push({ ...base, id: `nov23-${n}`, employee_name: employee, form_date: date, status, archived_at: flagged ? `${date}T23:00:00Z` : null, created_at: `${date}T10:00:00Z` });
      });
      vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));

      const seen: Out[] = [];
      t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "find_past_forms");
        if (results.length === 0) return { tool: "find_past_forms", input: { form: "CA", date_from: "2026-11-01", date_to: "2026-11-20", forms_on_file_evidence: evidenceFrom(view, QUESTION) } };
        seen.push(...results.map((result) => result.output as Out));
        return { text: "Here's what's on file." };
      }));
      await t.thread().say(QUESTION);
      const read = seen[0];
      expect(read?.counts?.total, JSON.stringify(read?.counts)).toBe(8);
      expect(statusNames(read?.counts)).toEqual(["draft", "finalized"]);
      expect((read?.forms ?? []).filter((form) => form.status === "draft").length).toBe(5);
      expect((read?.forms ?? []).filter((form) => form.status === "finalized").length).toBe(3);
      expect(JSON.stringify(read), "an archived bucket or mark reached the model").not.toMatch(/archiv/i);
    },
  },
  {
    id: "nov23-no-archived-forms-chat-how-many-on-file",
    title: "\"how many forms are on file this month?\" (the chat's FORMS ON FILE block): COUNTS cover all 8 forms under draft or finalized only; no \"(archived)\", and no archived draft left out",
    report: REPORT,
    // Off in production: the chat's counts block is behind FORMS_ON_FILE_COUNTS_ENABLED (QA turns it on after a live test).
    status: { open: "FORMS_ON_FILE_COUNTS_ENABLED is off in production (QA turns it on after a live test)" },
    fixFlags: ["FORMS_ON_FILE_COUNTS_ENABLED", "FORMS_ON_FILE_DATE_RANGE_ENABLED"],
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-20T20:54:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const forms = t.forms() as Record<string, unknown>[];
      FORMS.forEach(([date, status, employee, flagged], n) => {
        forms.push({
          id: `nov23-chat-${n}`,
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
          archived_at: flagged ? `${date}T23:00:00Z` : null,
          revises_instance_id: null,
          template_key: "dpoa",
          template_name: "Corrective Action Form",
          employee_name: employee,
          form_date: date,
          created_at: `${date}T10:00:00Z`,
          updated_at: `${date}T10:00:00Z`,
        });
      });
      t.modelSays("Here are the forms on file.");
      await t.thread().say("how many CA forms are on file this month?");
      const block = t.lastFormRecords?.() ?? "";
      expect(block, block).toMatch(/COUNTS \(code counted every form the read found: 8\)/);
      expect(block).toMatch(/draft \d/);
      expect(block).toMatch(/finalized \d/);
      expect(block, "an archived bucket or mark reached the model").not.toMatch(/\(archived\)/i);
    },
  },
];
