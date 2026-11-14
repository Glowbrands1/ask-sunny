import { vi, expect } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * THE TYPE OF WARNING IS THE MANAGER'S, NEVER THE MODEL'S (QA's 38g live test, 14 Nov 2026; MODEL_WARNING_LEVEL_DISCARDED)
 * ============================================================================
 *
 * The manager's request as typed, the person invented. The card had no warning level ("I won't guess at them"); the
 * saved draft had Type of Warning Written, filled by the model: the draft showed it the group and wrote its tick when
 * no level was stated. The pack's drafting stand-in ticks Written, as the live model did. Ask Bubbles has discarded the
 * model's level since 9 Oct 2026.
 */
const REPORT = "QA's 38g live test, 14 Nov 2026: a CA with no level stated was saved with Written, ticked by the model";
const ROWAN: DirectoryRow = {
  id: "e-rowan-pellsby-38g",
  firstName: "Rowan",
  lastName: "Pellsby",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const SAID = "please make a ca for Rowan Pellsby for not doing the 10 minute sanitation on 11/12/26, she was told twice";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-14T02:25:00Z"));
  t.directory([...STAFF, ROWAN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV14_MODEL_WARNING_LEVEL_DISCARDED_CASES: ReplayCase[] = [
  {
    id: "nov14-model-warning-level-not-stated-stays-empty",
    title: `"${SAID}": no level was stated, so the card has none and the saved Type of Warning stays empty`,
    report: REPORT,
    // Changed on purpose (14 Nov 2026): fixed in production by MODEL_WARNING_LEVEL_DISCARDED_ENABLED, QA round 38l. Was OPEN.
    status: "fixed",
    fixFlags: ["MODEL_WARNING_LEVEL_DISCARDED_ENABLED"],
    async run(t) {
      const thread = start(t);
      const answer = await thread.say(SAID);
      expect(answer.formProposal, "no card").toBeTruthy();
      t.draftWrites(
        { observation: "Observed:\nRowan Pellsby did not complete the 10-minute sanitation on 11/12/26 after being told twice." },
        { warning_type: ["written"], offense_type: ["other"] },
      );
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "the model's level was saved").toEqual([]);
    },
  },
  {
    id: "nov14-model-warning-level-stated-verbal-kept",
    title: '"create a verbal ca for <A> …": the stated Verbal is kept whatever the model ticks',
    report: `${REPORT}: QA's guard, a stated level stays`,
    status: "fixed",
    fixFlags: ["MODEL_WARNING_LEVEL_DISCARDED_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("create a verbal ca for Rowan Pellsby for not doing the 10 minute sanitation on 11/12/26, she was told twice");
      t.draftWrites(
        { observation: "Observed:\nRowan Pellsby did not complete the 10-minute sanitation on 11/12/26 after being told twice." },
        { warning_type: ["written"] },
      );
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "the stated level").toEqual(["verbal"]);
    },
  },
  // The audit's "climbed a rung" shape (QA, 14 Nov 2026): 3 of 27 AI-filled levels were Written where the manager's only
  // level word was an EARLIER verbal warning. History is not this form's level.
  ...[
    ["late-again", "make a ca for Rowan Pellsby, late again 30 mins today. she got a verbal warning on 10/21"],
    ["register-again", "Rowan Pellsby left the register unlocked again tonight, she already had a verbal last month. create a ca"],
    ["previous-verbal", "create a corrective action for Rowan Pellsby for no call no show on 11/12/26. previous verbal 9/30/26"],
  ].map(([slug, said]): ReplayCase => ({
    id: `nov14-model-warning-level-climbed-rung-${slug}`,
    title: `"${said}": an earlier verbal is history, so the model's Written is not saved`,
    report: `${REPORT}: the audit's "climbed a rung" shape (Written where the manager only spoke of an earlier verbal)`,
    // Changed on purpose (14 Nov 2026): fixed in production by MODEL_WARNING_LEVEL_DISCARDED_ENABLED, QA round 38l. Was OPEN.
    status: "fixed",
    fixFlags: ["MODEL_WARNING_LEVEL_DISCARDED_ENABLED"],
    async run(t) {
      const thread = start(t);
      const answer = await thread.say(said!);
      expect(answer.formProposal, "no card").toBeTruthy();
      t.draftWrites({ observation: "Observed:\nRowan Pellsby did not meet the expectation." }, { warning_type: ["written"] });
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "the model's climbed level was saved").toEqual([]);
    },
  })),
];
