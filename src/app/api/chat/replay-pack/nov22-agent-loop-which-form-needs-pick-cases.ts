import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN OPEN "WHICH ONE SHOULD I OPEN?" IS ANSWERED BY THE MANAGER, NEVER BY THE MODEL
 * (port from Ask Bubbles 1b34db2: QA's Bubbles live re-run, 22 Nov 2026, A11, HIGH)
 * ============================================================================
 *
 * T1 "bring up a previously edited corrective action for <P>" listed three CAs and asked which one; T2 "this is a verbal
 * warning. previous coaching policy manual 10-15-26" picked none, yet the loop opened one by itself and saved changes on
 * it. QA: "The loop must never pick a form the manager didn't choose while a 'which one' question is open." The wording
 * is QA's; the person is Sunny's invented Remy Calder.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const LIVE = process.env.AGENT_LOOP_LIVE === "1";
const REPORT = "QA's Bubbles live re-run (22 Nov 2026, A11, HIGH), ported: after \"Which one should I open?\", changes that pick no form opened and wrote one";
const EDITS_NOT_A_PICK = "this is a verbal warning. previous coaching policy manual 10-15-26";

function start(t: ReplayContext, day = "2026-11-21T18:40:00Z") {
  vi.setSystemTime(new Date(day));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

async function createdCa(t: ReplayContext, day: string): Promise<string> {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: `Remy was 20 minutes late on ${day}.`, incident_date: `2026-${day.replace("/", "-")}`, policy: headingWith(view, /^attendance/i), person_evidence: evidenceFrom(view, "remy calder") } };
    return { text: "Here's the Corrective Action Form for **Remy**." };
  }));
  const thread = t.thread();
  await thread.say(`ca for remy calder, she was 20 minutes late on ${day}`);
  return thread.create();
}

export const NOV22_AGENT_LOOP_WHICH_FORM_NEEDS_PICK_CASES: ReplayCase[] = [
  {
    id: "nov22-a11-which-one-answered-with-edits-opens-nothing",
    title: `three CAs for Remy Calder listed with "Which one should I open?", then "${EDITS_NOT_A_PICK}": nothing is opened or written and the question is asked again; then "the 11/14 one" opens that form and the changes are saved on it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t, "2026-11-14T16:00:00Z");
      const ids = [await createdCa(t, "11/12"), await createdCa(t, "11/13"), await createdCa(t, "11/14")];
      start(t);
      const before = ids.map((id) => JSON.stringify(t.values(id)));
      const model = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        const found = lastResult(view, "find_past_forms") as { forms?: { instance_id: string; choice: string }[]; which_form_question?: string } | null;
        const opened = lastResult(view, "open_form") as { opened?: boolean; reason_code?: string } | null;
        if (/^bring up/.test(said)) {
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "corrective action", open: true, forms_on_file_evidence: evidenceFrom(view, "bring up a previously edited corrective action") } };
          return { text: `${(found.forms ?? []).map((form) => `- ${form.choice}`).join("\n")}\n\n${found.which_form_question ?? ""}` };
        }
        if (said.startsWith(EDITS_NOT_A_PICK)) {
          // The live model: it opens the newest form by itself, with no pick from the manager.
          if (!opened) return { tool: "open_form", input: { instance_id: ids[2]!, forms_on_file_evidence: evidenceFrom(view, "bring up a previously edited corrective action", 1) } };
          if (opened.opened) {
            if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: ids[2]!, values: { warning_type: "verbal", prior_actions: "JBA Policy Manual — 11/05/2026" }, level_evidence: evidenceFrom(view, "this is a verbal warning") } };
            return { text: "Opened the most recent one." };
          }
          return { text: "I'll put the verbal warning and the 10/15/26 prior coaching on the form you pick. Which one should I open?" };
        }
        // "the 11/14 one": the manager's pick.
        if (!opened) return { tool: "open_form", input: { instance_id: ids[2]!, forms_on_file_evidence: evidenceFrom(view, "bring up a previously edited corrective action", 2), choice_evidence: evidenceFrom(view, "the 11/14 one") } };
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: ids[2]!, values: { warning_type: "verbal", prior_actions: "Coaching — JBA Policy Manual — 10/15/2026" }, level_evidence: evidenceFrom(view, "this is a verbal warning", 1) } };
        return { text: "Opened the Corrective Action Form from 11/14/2026." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const listed = await thread.say("bring up a previously edited corrective action for remy calder");
      expect(listed.content, "the three forms were not listed with the which-one question (the case proves nothing)").toContain("Which one should I open?");
      const reply = await thread.say(EDITS_NOT_A_PICK);
      const refused = model.views.flatMap((view) => view.results.filter((result) => result.tool === "open_form")).at(-1)?.output as { reason_code?: string } | undefined;
      // QA's live run (22 Nov 2026): the real model asked again and never called open_form, so there was no refusal to
      // read. What the manager sees and what is saved are asserted below (nothing on screen, no form written, the question
      // asked again); the refusal whenever open_form was called (the stand-in always calls it).
      if (!LIVE || refused !== undefined) expect(refused?.reason_code, "a form the manager never picked was opened").toBe("which_form_not_chosen");
      expect(reply.formOpened, "a form the manager never picked is on screen").toBeFalsy();
      expect(ids.map((id) => JSON.stringify(t.values(id))), "a form the manager never picked was written").toEqual(before);
      expect(reply.content).toMatch(/Which one should I open\?/);
      const picked = await thread.say("the 11/14 one");
      expect(picked.formOpened?.instanceId, "the form the manager picked was not opened").toBe(ids[2]);
    },
  },
];
