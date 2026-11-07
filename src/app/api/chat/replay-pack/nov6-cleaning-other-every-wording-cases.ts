import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CLEANING LEFT UNDONE IS OTHER IN EVERY WORDING (QA, 6 Nov 2026; Pau's ruling)
 * ============================================================================
 *
 * QA's live eval `ca-sales-negative-cleaning-duties` ("make a corrective action
 * for <name>, he did not complete daily cleaning duties"), run with
 * CHAT_GLOSSARY + CA_SALES_POLICY + REPLY_MATCHES_CARD + TITLE_OF_THE_EMPLOYEE +
 * METRIC_GUARD, 2 of 2 runs: "the card cites the Standards of Conduct for
 * cleaning". The stand-in model here writes the Other line for that wording,
 * so the live model's own line is covered by `ai/reply-matches-card-cleaning.test.ts`.
 *
 * With the same flags, three more wordings got no Policy line at all and a
 * draft whose model ticked the Standards of Conduct kept it: the cleaning
 * reader did not read "not completing … cleaning". The person is invented.
 */

type T = ReplayContext;

const ANSGAR: DirectoryRow = {
  id: "e-ansgar-whitlowe",
  firstName: "Ansgar",
  lastName: "Whitlowe",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const QA_LIVE = ["CHAT_GLOSSARY_ENABLED", "CA_SALES_POLICY_ENABLED", "REPLY_MATCHES_CARD_ENABLED", "TITLE_OF_THE_EMPLOYEE_ENABLED", "METRIC_GUARD_ENABLED"];
const FLAG = "CLEANING_OTHER_EVERY_WORDING_ENABLED";
const REPORT = "QA, 6 Nov 2026: cleaning wordings with QA's live flag set (Pau's ruling: cleaning is Other)";

const policyLine = (content: string) => content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";

async function cleaningIsOther(t: T, said: string): Promise<void> {
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory([...STAFF, ANSGAR]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(said);
  expect(thread.proposal, `no CA card for Ansgar Whitlowe:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Ansgar Whitlowe" });
  expect(policyLine(reply.content), `the card's Policy line is not Other:\n${reply.content}`).toMatch(/\*\*Policy:\*\* Other\b/);
  expect(reply.content, `the card cites the Standards of Conduct for cleaning:\n${reply.content}`).not.toMatch(/Standards of Conduct[^\n]*JBA Policy Manual/i);
  // The drafting model ticks the Standards of Conduct and sends no basis (QA's live failure on the draft).
  t.draftWrites({ observation: "Observed:\nAnsgar Whitlowe did not complete his daily cleaning duties." }, { offense_type: ["standards_of_conduct"] });
  const id = await thread.create();
  expect(t.checked(id).offense_type, "the draft's Type of Offense").toEqual(["other"]);
  expect(t.values(id).policy_violated ?? "", "Policy Violated").not.toMatch(/Standards of Conduct/i);
}

const OPEN: readonly { id: string; said: string }[] = [
  { id: "not-completing-daily", said: "create a verbal ca for Ansgar Whitlowe for not completing his daily cleaning duties on 11-2-26" },
  { id: "not-completing-closing", said: "CA for Ansgar Whitlowe for not completing closing cleaning tasks" },
  { id: "did-not-clean-beds", said: "write a CA for Ansgar Whitlowe, he did not clean the beds after each session" },
];

export const NOV6_CLEANING_OTHER_EVERY_WORDING_CASES: ReplayCase[] = [
  ...OPEN.map(
    ({ id, said }): ReplayCase => ({
      id: `nov6-cleaning-other-${id}`,
      title: `"${said}": the card says Other and the draft ticks Other, never the Standards of Conduct`,
      report: REPORT,
      status: { open: "with production's flags (CA_SALES off) cleaning is not Other" },
      fixFlags: [...QA_LIVE, FLAG],
      async run(t) {
        await cleaningIsOther(t, said);
      },
    }),
  ),
  {
    id: "nov6-cleaning-other-qa-live-wording",
    title: "QA's live wording \"make a corrective action for <name>, he did not complete daily cleaning duties\": Other on the card and the draft",
    report: `${REPORT}; live eval ca-sales-negative-cleaning-duties`,
    // Changed on purpose (7 Nov 2026): QA's flips of 5 and 6 Nov turned CA_SALES_POLICY, REPLY_MATCHES_CARD, TITLE_OF_THE_EMPLOYEE, METRIC_GUARD, TITLE_ENDS_AT_LINE, BARE_NOT_DENIAL and PLACE_FROM_CUE on in production (production-flags.json); this case now holds with production's flags.
    status: "fixed",
    fixFlags: [...QA_LIVE, FLAG],
    async run(t) {
      await cleaningIsOther(t, "make a corrective action for Ansgar Whitlowe, he did not complete daily cleaning duties");
    },
  },
];
