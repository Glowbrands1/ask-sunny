import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * A PERSON WHO IS NOT IN WOVEN CAN STILL GET A FORM (QA, the flip-3 gate,
 * 6 Nov 2026; OFF_ROSTER_CONFIRM_ENABLED)
 * ============================================================================
 *
 * Exit forms are often for people just removed from Woven. With the name flags
 * of flip 3 (FORM_NAME_FROM_ROSTER), a card's employee comes from the roster
 * only, so an exit form or a Corrective Action for somebody not on it asked
 * "Who is this form for?" again on every answer — the typed name again, "yes,
 * use that name", "she is not in Woven anymore" — and a card with no employee
 * has no Create button. The manager could never finish. Production today (the
 * name flags off) makes the card with the typed name.
 *
 * With OFF_ROSTER_CONFIRM_ENABLED the not-found note offers "reply **use
 * <name>**"; that, "yes", or the same name typed again puts the typed name on
 * the card, which says it is not from Woven. The names are invented and on no
 * directory.
 */
const NAME_FLAGS = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

const EXIT_LINES =
  "Thessaly Varrow\nTeam Member Part Time \nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\neligible for rehire";

const OFFERS_USE = /reply \*\*use [^*]+\*\*/i;

/**
 * The manager's turns, then the answer (at most twice) until the card is ready. The card is the typed name's, ready to
 * create; when the app said the name is not in Woven, the reply and the card both say the name is not from Woven.
 */
async function finishes(thread: ReplayThread, turns: readonly string[], answer: string, name: string): Promise<void> {
  let reply = { content: "" };
  let offered = false;
  for (const turn of turns) {
    reply = await thread.say(turn);
    offered ||= OFFERS_USE.test(reply.content);
  }
  // At most two answers: where the app had not read the name yet, the first answer gives it and gets the offer.
  for (let answered = 0; answered < 2 && thread.proposal?.status !== "ready"; answered += 1) {
    reply = await thread.say(answer);
    offered ||= OFFERS_USE.test(reply.content);
  }
  expect(thread.proposal, `no card the manager can create:\n${reply.content}`).toMatchObject({ employeeName: name, status: "ready" });
  if (offered) {
    expect(reply.content, `the reply never says the name is not from Woven:\n${reply.content}`).toMatch(/isn['’]t in the Woven roster/);
    expect(thread.proposal?.wovenCloseMatch ?? "", "the card never says the name is not from Woven").toMatch(/not in Woven/i);
  }
}

function offRosterCase(id: string, title: string, turns: readonly string[], answer: string, name: string): ReplayCase {
  return {
    id,
    title,
    report: "The sibling app's flip-3 gate (QA, 6 Nov 2026), checked here: with the name flags on, a form for somebody not in Woven loops on \"Who is this form for?\" and has no Create button",
    status: "fixed",
    fixFlags: NAME_FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      await finishes(t.thread(), turns, answer, name);
    },
  };
}

export const NOV6_OFF_ROSTER_CONFIRM_CASES: ReplayCase[] = [
  offRosterCase(
    "nov6-off-roster-exit-own-line-use",
    "(a) exit form, the name alone on its own line, not in Woven: \"use <name>\" makes the card",
    ["Can you create an exit form for me?", EXIT_LINES],
    "use Thessaly Varrow",
    "Thessaly Varrow",
  ),
  offRosterCase(
    "nov6-off-roster-exit-own-line-name-again",
    "(a) exit form, the name alone on its own line, not in Woven: the full name typed again makes the card",
    ["Can you create an exit form for me?", EXIT_LINES],
    "Thessaly Varrow",
    "Thessaly Varrow",
  ),
  offRosterCase(
    "nov6-off-roster-exit-for-name-yes",
    "(b) \"exit form for <name>, …\", not in Woven: \"yes, use that name\" makes the card",
    ["exit form for Thessaly Varrow, she gave notice 9/25/26 and her last day was 10/9/26, resigning to pursue other career options"],
    "yes, use that name",
    "Thessaly Varrow",
  ),
  offRosterCase(
    "nov6-off-roster-ca-use",
    "(c) a Corrective Action for somebody not in Woven: \"use <name>\" makes the card",
    ["create a ca form for Zebulon Marchbanks, he was late opening the salon on 11/2"],
    "use Zebulon Marchbanks",
    "Zebulon Marchbanks",
  ),
  {
    id: "nov6-off-roster-near-miss-never-offers-use",
    title: "the reverse: a near miss of a roster person (\"Remy Caldor\") is never offered as a name not in Woven",
    report: "The sibling app's flip-3 gate (QA, 6 Nov 2026): the off-roster offer never replaces the near-miss question",
    status: "fixed",
    fixFlags: NAME_FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a ca form for Remy Caldor, he was late opening the salon on 11/2");
      expect(reply.content, `the near miss is offered as somebody not in Woven:\n${reply.content}`).not.toMatch(OFFERS_USE);
    },
  },
];
