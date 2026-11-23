import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "OPEN <FIRST>S CA" ASKS ABOUT <FIRST>'S FORMS (QA's 266-chat shadow re-run S1, 22 Nov 2026; high: a stuck loop)
 * ============================================================================
 *
 * M1 "open <First>s ca" (a possessive typed with no apostrophe): find_past_forms refused it as "about someone else, not
 * this person, so this person's forms stay closed", find_staff matched <First> <Last>, and find_past_forms again got
 * the same refusal; the manager's "1" then went round five more turns. The words name the person: "<First>s" is
 * "<First>'s". Invented person: Remy Calder (STAFF).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266-chat shadow re-run (22 Nov 2026), S1: \"open <First>s ca\" refused as someone else's forms, a stuck loop";

type Found = { forms?: { instance_id?: string }[]; best_match?: string; reason_code?: string; ask_exactly?: string };

/** Remy Calder's CA on file (a finalized draft), made the way the pack makes one. */
async function onFile(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was late to open on 11/19.", incident_date: "2026-11-19" } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, late to open on 11/19");
  const id = await setup.create();
  vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
  return id;
}

export const NOV22_AGENT_LOOP_POSSESSIVE_NO_APOSTROPHE_OPENS_CASES: ReplayCase[] = [
  {
    id: "nov22-s1-open-firsts-ca-not-someone-else",
    title: "S1: \"open Remys ca\": find_past_forms for Remy Calder is not refused as someone else's forms; Remy's CA is found",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const id = await onFile(t);
      const said = "open Remys ca";
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "ca", open: true, forms_on_file_evidence: evidenceFrom(view, said) } };
        return { text: found.ask_exactly ?? "Opening the form." };
      });
      t.loopModel!(model);
      await t.thread().say(said);
      const found = lastResult(model.views.at(-1)!, "find_past_forms") as Found;
      expect(found.reason_code ?? null, JSON.stringify(found)).not.toBe("privacy_not_this_person");
      expect([found.best_match, ...(found.forms ?? []).map((form) => form.instance_id)], JSON.stringify(found)).toContain(id);
    },
  },
  {
    id: "nov22-s1-open-other-persons-ca-still-closed",
    title: "Control: \"open Junos ca\" (another roster person's possessive) still keeps Remy Calder's forms closed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await onFile(t);
      const said = "open Junos ca";
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "ca", open: true, forms_on_file_evidence: evidenceFrom(view, said) } };
        return { text: "ok" };
      });
      t.loopModel!(model);
      await t.thread().say(said);
      const found = lastResult(model.views.at(-1)!, "find_past_forms") as Found;
      expect(found.reason_code, JSON.stringify(found)).toBe("privacy_not_this_person");
    },
  },
];
