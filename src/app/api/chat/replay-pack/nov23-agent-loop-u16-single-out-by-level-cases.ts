import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "PUT UP THE VERBAL CA FOR <P>" SINGLES OUT THE VERBAL ONE BY ITS OWN LEVEL (U16 again; QA, 23 Nov 2026)
 * ============================================================================
 *
 * Sunny's live set and Ask Bubbles' live re-run, U16 word for word (the person invented): "put up the verbal CA for <P>"
 * answered "none specify 'verbal' so I can't single one out" and listed 7 Corrective Actions, while the same forms read as
 * "Corrective Action Form, Verbal Warning" elsewhere. The narrowing (#1224's port of Bubbles #1044) read only the words
 * the model passed (its form, about and quote); the live model quoted "put up" and asked for "CA", so "verbal" never
 * reached it, and the list it got carried no level. Now the manager's own message is read too, and each Corrective
 * Action's level, from its own Type of Warning on the form, is on its row and in its choice line. Several verbal CAs still
 * ask which.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "U16 (QA, 23 Nov 2026; Sunny's live set and Bubbles' live re-run): \"put up the verbal CA for <P>\" answered \"none specify 'verbal' so I can't single one out\" and listed 7 forms";
const ORIEL: DirectoryRow = { id: "e-oriel-tamsworth", firstName: "Oriel", lastName: "Tamsworth", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "put up the verbal CA for Oriel Tamsworth";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

type Found = { forms?: { instance_id?: string; level?: string; choice?: string }[]; best_match?: string; which_form_question?: string } | null;

/** Oriel's Corrective Actions on file: `levels`, one finalized form each, dated a week apart. */
function onFile(t: ReplayContext, levels: readonly string[]): string[] {
  const ids = t.templateIds!("dpoa");
  const made = levels.map((level, index) => {
    const day = String(1 + index * 4).padStart(2, "0");
    const id = `ca-oriel-${index + 1}-${level}`;
    (t.forms() as Record<string, unknown>[]).push({
      id, ...ids, variant_key: null, employee_role: null,
      location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney", created_by: "another-manager", created_by_role: "salon_director",
      source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null, revises_instance_id: null,
      template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Oriel Tamsworth", form_date: `2026-10-${day}`,
      created_at: `2026-10-${day}T15:00:00Z`, updated_at: `2026-10-${day}T15:00:00Z`,
    });
    t.typeOnForm(id, { observation: `Oriel was late to open on 10/${day}/26.` });
    t.checkOnForm!(id, { warning_type: [level] });
    return id;
  });
  return made;
}

async function putUp(t: ReplayContext, levels: readonly string[]) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, ORIEL]);
  t.as("admin", ADMIN);
  const ids = onFile(t, levels);
  // The live model: form "CA", the quote "put up" (the level is in the manager's message only).
  const model = loopStandIn((view): LoopDecision => {
    const found = lastResult(view, "find_past_forms") as Found;
    if (!found) return { tool: "find_past_forms", input: { employee_name: "Oriel Tamsworth", form: "CA", open: true, forms_on_file_evidence: evidenceFrom(view, "put up") } };
    return { text: "ok" };
  });
  t.loopModel!(model);
  await t.thread().say(T1);
  return { ids, found: lastResult(model.views.at(-1)!, "find_past_forms") as Found };
}

export const NOV23_AGENT_LOOP_U16_SINGLE_OUT_BY_LEVEL_CASES: ReplayCase[] = [
  {
    id: "nov23-u16-put-up-verbal-singles-out-by-level",
    title: `U16 verbatim: "${T1}" with 7 CAs on file, one of them a Verbal Warning, and the model quoting only "put up": the one verbal CA is the match, its row says Verbal Warning`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { ids, found } = await putUp(t, ["written", "written", "written", "verbal", "written", "written", "termination"]);
      const verbal = ids[3]!;
      expect((found?.forms ?? []).map((form) => form.instance_id), JSON.stringify(found).slice(0, 800)).toEqual([verbal]);
      expect(found?.best_match, "the one verbal CA is not the match").toBe(verbal);
      expect(found?.forms?.[0]?.level).toBe("Verbal Warning");
      expect(found?.forms?.[0]?.choice ?? "").toMatch(/Corrective Action Form · Verbal Warning · /);
    },
  },
  {
    id: "nov23-u16-control-two-verbal-cas-still-ask",
    title: `Control: "${T1}" with two Verbal Warning CAs on file: both are listed, each with its level, and the which-one question stays`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { ids, found } = await putUp(t, ["written", "verbal", "verbal"]);
      expect((found?.forms ?? []).map((form) => form.instance_id).sort()).toEqual([ids[1], ids[2]].sort());
      expect((found?.forms ?? []).every((form) => form.level === "Verbal Warning")).toBe(true);
      expect(found?.which_form_question, "several verbal CAs no longer ask which").toBeTruthy();
    },
  },
];
