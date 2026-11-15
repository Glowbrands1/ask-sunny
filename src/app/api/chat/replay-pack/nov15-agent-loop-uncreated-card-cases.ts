import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "MAKE IT A WRITTEN" ON A CARD THAT WAS NEVER CREATED (QA's audit, 15 Nov 2026, PR 7c)
 * ============================================================================
 *
 * A card on screen is not a saved form: nothing exists until the manager presses Create. The model, answering "make it
 * a written", can reach for edit_form with an id that is not a saved form (the card has none). The reply must not say a
 * saved form changed; the level belongs on the card; and the saved forms stay empty. Each case ends with the saved form
 * and the reply agreeing. Invented people only.
 *
 * TODO(PR4): the refusal's reason code is `not_a_saved_form` (tools.ts today answers "could not be changed just now");
 * once it lands, assert the code beside the empty `updated`.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's audit (15 Nov 2026): a level answer on a card never created (rebuild plan, PR 7c)";

const TEST_TESTY: DirectoryRow = { id: "e-test-testy", firstName: "Test", lastName: "Testy", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ACCOUNT = "Test Testy was late to open the salon on 11/10.";
const UNSAVED_ID = "card-not-created-yet";

export const NOV15_AGENT_LOOP_UNCREATED_CARD_CASES: ReplayCase[] = [
  {
    id: "nov15-uncreated-card-make-it-a-written",
    title: "\"make it a written\" on a card never created: the model's edit_form on a non-saved id changes nothing and is not reported as a change; the written reaches the card; no form is saved",
    report: `${REPORT}; the manager's exact words: "make it a written"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const answered = said === "make it a written";
        if (!answered) return lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TEST_TESTY.id, what_happened: ACCOUNT } };
        // The model reaches for the form it has not been given, then puts the level on the card.
        if (!lastResult(view, "edit_form") && !lastResult(view, "propose_form")) return { tool: "edit_form", input: { instance_id: UNSAVED_ID, values: { warning_type: "written" } } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TEST_TESTY.id, what_happened: ACCOUNT, warning_level: "written" } };
        return { text: "Here's the card." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for test testy, she was late to open the salon on 11/10");
      const reply = await thread.say("make it a written");
      const edit = model.views.flatMap((view) => view.results).find((result) => result.tool === "edit_form")?.output ?? {};
      expect(edit.updated ?? [], "edit_form reported a change on a form that was never saved").toEqual([]);
      expect(reply.formUpdate, "the reply carries a saved-form update").toBeUndefined();
      expect(t.forms(), "a form was saved by a level answer on a card").toEqual([]);
      expect(thread.proposal?.warningLevel, "the written is not on the card").toBe("written");
    },
  },
  {
    id: "nov15-uncreated-card-then-create-saves-the-written",
    title: "after \"make it a written\" on an uncreated card, Create saves a draft that holds the written the card showed, and nothing before Create did",
    report: `${REPORT}; the card and the saved form agree`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TEST_TESTY.id, what_happened: ACCOUNT, ...(said === "make it a written" ? { warning_level: "written" } : {}) } };
      }));
      const thread = t.thread();
      await thread.say("ca for test testy, she was late to open the salon on 11/10");
      await thread.say("make it a written");
      expect(t.forms(), "a form existed before Create").toEqual([]);
      const id = await thread.create();
      expect(t.checked(id).warning_type, "the saved draft does not hold the card's written").toEqual(["written"]);
    },
  },
];
