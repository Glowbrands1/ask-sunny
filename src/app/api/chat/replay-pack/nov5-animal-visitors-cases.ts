import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN ANIMAL ALONE IS ANIMALS IN THE WORKPLACE; VISITORS ONLY WITH A VISITOR
 * (Pau's ruling for both apps, 5 Nov 2026, relayed by QA: "I choose 1")
 * ============================================================================
 *
 * The sibling app's template draft check (5 Nov 2026) read "management will review the
 * Animals in the Workplace and Visitors in the Workplace policies" for an
 * account that described only an animal. Pau: an animal alone cites ONLY
 * Animals in the Workplace; Visitors in the Workplace is added only when the
 * manager's words involve a visitor (the animal is a visitor's, customer's or
 * guest's, or a visitor is described). Here the card itself cites Animals
 * only; the extra Visitors is on the draft (Direct policy and the Action
 * Plan), so each case reads the card and the draft made from it. Cases only
 * until the fix exists: no fixFlags. Every person is invented.
 */

type T = ReplayContext;

const CORWIN: DirectoryRow = {
  id: "e-corwin-hale",
  firstName: "Corwin",
  lastName: "Hale",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function animalVisitorsPeople(): readonly DirectoryRow[] {
  return [CORWIN];
}

const REPORT = "Pau's ruling via QA, 5 Nov 2026 (template draft check: Visitors added for an animal alone)";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, CORWIN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const VISITORS = /Visitors in the Workplace/i;
const ANIMALS = /Animals in the Workplace/i;

/** The card and the draft made from it, as one text: the card's lines, then the draft's Policy Violated, Direct policy and Action Plan. */
async function cardAndDraft(t: T, thread: ReturnType<T["thread"]>, reply: ReplayAnswer, observation: string): Promise<string> {
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
  t.draftWrites({ observation: `Observed:\n${observation}` });
  const values = t.values(await thread.create());
  return [reply.content, values.policy_violated ?? "", values.policy_language ?? "", values.action_plan ?? ""].join("\n---\n");
}

export const NOV5_ANIMAL_VISITORS_CASES: ReplayCase[] = [
  {
    id: "nov5-animal-alone-no-visitors",
    title: "(a) \"he brought his new kitten to the salon\": Animals in the Workplace only — no Visitors in the Workplace on the card, in Direct policy or in the Action Plan",
    report: `${REPORT}, (a)`,
    status: { open: "with production's flags the draft quotes Visitors in the Workplace in Direct policy and its Action Plan reviews \"the Animals in the Workplace and Visitors in the Workplace policies\"" },
    fixFlags: ["ANIMAL_VISITORS_ONLY_WHEN_VISITOR_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca for corwin hale at kearney. he brought his new kitten to the salon on 11-4-26. verbal. no payroll deduct");
      const all = await cardAndDraft(t, thread, reply, "Corwin Hale brought his new kitten to the salon on November 4, 2026.");
      expect(all, `Animals in the Workplace is not cited:\n${all}`).toMatch(ANIMALS);
      expect(all, `Visitors in the Workplace for an animal alone (card or draft):\n${all}`).not.toMatch(VISITORS);
    },
  },
  {
    id: "nov5-animal-customer-dog-visitors",
    title: "(b) a customer brought a dog in and the employee let them stay: Animals in the Workplace and Visitors in the Workplace",
    report: `${REPORT}, (b)`,
    status: "fixed",
    fixFlags: ["ANIMAL_VISITORS_ONLY_WHEN_VISITOR_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca for corwin hale at kearney. a customer brought her dog into the salon on 11-4-26 and corwin let them stay. verbal. no payroll deduct");
      const all = await cardAndDraft(t, thread, reply, "A customer brought her dog into the salon on November 4, 2026, and Corwin Hale let them stay.");
      expect(all, `Animals in the Workplace is not cited:\n${all}`).toMatch(ANIMALS);
      expect(all, `a customer's dog without Visitors in the Workplace (card or draft):\n${all}`).toMatch(VISITORS);
    },
  },
  {
    id: "nov5-visitor-alone-control",
    title: "(c) a visitor in the back room, no animal — Visitors in the Workplace only",
    report: `${REPORT}, (c)`,
    // Meant as a control, but open today: "had a visitor in the back room" cites no policy at all (card and draft).
    status: { open: "with production's flags nothing cites Visitors in the Workplace for \"had a visitor in the back room\"" },
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca for corwin hale at kearney. he had a visitor in the back room during his shift on 11-4-26. verbal. no payroll deduct");
      const all = await cardAndDraft(t, thread, reply, "Corwin Hale had a visitor in the back room during his shift on November 4, 2026.");
      expect(all, `a visitor in the back room without Visitors in the Workplace (card or draft):\n${all}`).toMatch(VISITORS);
      expect(all, `Animals in the Workplace with no animal:\n${all}`).not.toMatch(ANIMALS);
    },
  },
];
