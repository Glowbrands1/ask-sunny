import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * WOVEN WORK NOT DONE BY ITS DEADLINE IS THE STANDARDS OF CONDUCT (Pau's ruling, 6 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app. There, three managers, three live chats (4–5 Nov 2026), word for word with the
 * employee swapped for an invented one, got three behaviours for the same
 * thing — assigned Woven policy acknowledgements not completed by a deadline:
 *
 *   "start a corrective action for <name> for not signing the woven policies
 *   by 10-30-26 and she signed the jba policy manual on 10-15-26"
 *     → "**Policy:** Woven does not see a section of the current policy manual
 *       for "not signing the woven" …, so I won't cite one."
 *   "create verbal ca for <name>. on 10-16-26 <first> was assigned to complete
 *   policy acknowledgements in Woven by 10-31-26. <first> failed to meet the
 *   10-31-26 deadline."
 *     → a tentative "this reads as **Standards of Conduct** … if the manual
 *       doesn't support it, I'll leave the policy for you", and an Action Plan
 *       naming "the applicable company policy"
 *   "create a verbal warning for <name>. previous coaching: JBA Policy Manual
 *   10-15-26. <first> did not complete the assigned policy acknowledgements in
 *   Woven by the 10-31-26 deadline."
 *     → no Policy line at all, and "the applicable company policy"
 *
 * This app, with production's flags: no Policy line for the first, a tentative
 * "this reads as **Standards of Conduct** … if the manual doesn't support it"
 * for the other two.
 *
 * Pau, 6 Nov 2026: such a Corrective Action always cites the Standards of
 * Conduct, with the manual's section and page. WOVEN_TRAINING_CONDUCT_ENABLED.
 */

type T = ReplayContext;

const REPORT = "The sibling app's live chats, 4–5 Nov 2026; Pau's ruling 6 Nov 2026 (relayed by QA)";
const FLAG = "WOVEN_TRAINING_CONDUCT_ENABLED";

const SAID: readonly { id: string; said: string; live: string }[] = [
  {
    id: "not-signing",
    said: "start a corrective action for rowan kestrel for not signing the woven policies by 10-30-26 and she signed the jba policy manual on 10-15-26",
    live: "no Policy line, and \"the applicable company policy\" in the Action Plan",
  },
  {
    id: "failed-to-meet",
    said: "create verbal ca for rowan kestrel. on 10-16-26 Rowan was assigned to complete policy acknowledgements in Woven by 10-31-26. Rowan failed to meet the 10-31-26 deadline.",
    live: "a tentative Standards of Conduct",
  },
  {
    id: "did-not-complete",
    said: "create a verbal warning for Rowan Kestrel. previous coaching: JBA Policy Manual 10-15-26. Rowan did not complete the assigned policy acknowledgements in Woven by the 10-31-26 deadline.",
    live: "a tentative Standards of Conduct",
  },
];

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T18:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function line(reply: ReplayAnswer, label: RegExp): string {
  return reply.content.split("\n").find((row) => label.test(row)) ?? "";
}

export const NOV6_WOVEN_TRAINING_CONDUCT_CASES: ReplayCase[] = SAID.map(
  ({ id, said, live }): ReplayCase => ({
    id: `nov6-woven-training-conduct-${id}`,
    title: `"${said.slice(0, 70)}…": the card and the draft cite the Standards of Conduct, section and page`,
    report: `${REPORT}: here, ${live}`,
    status: { open: `with production's flags: ${live}` },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(said);
      expect(thread.proposal, `no CA card for Rowan Kestrel:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      const policy = line(reply, /\*\*Policy:?\*\*/);
      expect(policy, `the card does not cite the Standards of Conduct:\n${reply.content}`).toMatch(/^\*\*Policy:\*\* Standards of Conduct\b/);
      expect(policy, `the card's policy is tentative:\n${reply.content}`).not.toMatch(/reads as|doesn't support|won't cite/i);
      expect(reply.content, `"Woven" does not see a section:\n${reply.content}`).not.toMatch(/Woven does not see/);
      const plan = line(reply, /\*\*Action plan:\*\*/);
      expect(plan, `the Action Plan does not name the Standards of Conduct:\n${reply.content}`).not.toMatch(/applicable company policy/);
      t.draftWrites({ observation: "Observed:\nRowan Kestrel did not complete the assigned policy acknowledgements in Woven by the 10/31/2026 deadline." });
      const created = await thread.create();
      expect(t.checked(created).offense_type ?? [], "Type of Offense is not Standards of Conduct").toEqual(["standards_of_conduct"]);
      const values = t.values(created);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy does not name the Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy has no page").toMatch(/\bp(?:age|\.)\s*\d+/i);
      expect(values.action_plan ?? "", "the draft's Action Plan names no policy").not.toMatch(/applicable company policy/);
    },
  }),
);
