import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "WHO GOT A CA THIS MONTH?" READS EVERY CA IN THE MONTH, NOT THE NEWEST 20 FORMS (FORMS_ON_FILE_DATE_RANGE_ENABLED)
 * ============================================================================
 *
 * The owner, 18 Nov 2026, on the sibling app's Leadership Assistant: "who got a CA this month?" was answered "In the 20
 * most recent forms I can see … The list is capped at 20, so older November forms may not appear", and the owner asked
 * "why capped at 20". This app's chat reads Form Monitoring the same way (`forms/chat-form-records.ts`). On: the
 * question's month and kind of form narrow the query, so the answering model is given every November CA and is told
 * the list is complete.
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the forms are put on file directly (the harness's form rows), 25 November CAs at
 * the manager's salon behind 20 newer coaching forms. The invariant is on the FORMS ON FILE block the answering model was
 * given to answer from, not on its scripted words.
 */

const QUESTION = "who got a CA this month?";
const FLAG = "FORMS_ON_FILE_DATE_RANGE_ENABLED";
const REPORT = 'The owner, 18 Nov 2026 (sibling app\'s Leadership Assistant): "who got a CA this month?" answered from "the 20 most recent forms … capped at 20"; "why capped at 20"';

function onFile(t: ReplayContext): void {
  const forms = t.forms() as Record<string, unknown>[];
  const put = (index: number, fields: Record<string, unknown>) =>
    forms.push({
      id: `nov18-range-${index}`,
      template_id: "t",
      template_version_id: "v",
      variant_key: null,
      employee_role: null,
      location_id: KEARNEY.primaryAreaId,
      location_name: "NE Kearney",
      created_by: "another-manager",
      created_by_role: "salon_director",
      source: "ask_sunny",
      status: "finalized",
      follow_up_date: null,
      archived_at: null,
      revises_instance_id: null,
      ...fields,
    });
  for (let day = 1; day <= 25; day += 1) {
    const date = `2026-11-${String(Math.min(day, 17)).padStart(2, "0")}`;
    put(day, { template_key: "dpoa", template_name: "Corrective Action Form", employee_name: `Corrin Vale${String.fromCharCode(96 + day)}`, form_date: date, created_at: `${date}T15:00:${String(day).padStart(2, "0")}Z`, updated_at: `${date}T15:00:00Z` });
  }
  for (let i = 0; i < 20; i += 1) {
    put(100 + i, { template_key: "coaching", template_name: "Coaching Form", employee_name: `Coached Teammate${String.fromCharCode(97 + i)}`, form_date: "2026-11-18", created_at: `2026-11-18T16:00:${String(i).padStart(2, "0")}Z`, updated_at: "2026-11-18T16:00:00Z" });
  }
  put(200, { template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Octavia Brannigan", form_date: "2026-10-30", created_at: "2026-10-30T15:00:00Z", updated_at: "2026-10-30T15:00:00Z" });
}

export const NOV18_FORMS_ON_FILE_DATE_RANGE_CASES: ReplayCase[] = [
  {
    id: "nov18-forms-on-file-date-range-who-got-a-ca-this-month",
    title: `"${QUESTION}" with 25 November CAs behind 20 newer coaching forms: the model is given every November CA, and told the list is complete`,
    report: REPORT,
    // Fixed in production by FORMS_ON_FILE_DATE_RANGE_ENABLED (on in Vercel, 18 Nov 2026, the owner's request).
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      onFile(t);
      t.modelSays("Here are this month's corrective actions.");
      await t.thread().say(QUESTION);
      const system = t.lastFormRecords?.() ?? "";
      for (let day = 1; day <= 25; day += 1) {
        expect(system, `November CA ${day} was not given to the model`).toContain(`Corrin Vale${String.fromCharCode(96 + day)};`);
      }
      expect(system).not.toContain("Coached Teammate");
      expect(system).not.toContain("Octavia Brannigan");
      expect(system).toContain("Never say the list is capped");
    },
  },
  {
    id: "nov18-forms-on-file-date-range-agent-loop-period-list",
    title: `the tool loop: "${QUESTION}" lists every November CA through find_past_forms with no employee (form and dates), complete`,
    report: REPORT,
    // The loop's own date and form inputs narrow the read; no chat flag needed (the stand-in lists this manager).
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      onFile(t);
      const asker = loopStandIn((view): LoopDecision =>
        lastResult(view, "find_past_forms")
          ? { text: "Here are this month's corrective actions." }
          : { tool: "find_past_forms", input: { form: "CA", date_from: "2026-11-01", date_to: "2026-11-18", forms_on_file_evidence: evidenceFrom(view) } },
      );
      t.loopModel!(asker);
      await t.thread().say(QUESTION);
      const result = asker.views.flatMap((view) => view.results).find((entry) => entry.tool === "find_past_forms")?.output ?? {};
      expect(result.error, `the period list was refused: ${JSON.stringify(result)}`).toBeUndefined();
      const names = ((result.forms ?? []) as { employee: string }[]).map((form) => form.employee);
      expect(names).toHaveLength(25);
      expect(names.every((name) => name.startsWith("Corrin Vale"))).toBe(true);
      expect(result.complete).toBe(true);
    },
  },
];
