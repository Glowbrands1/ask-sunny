import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A METRIC IS NEVER OFFERED AS THE PERSON (QA's LIVE=1, 5 Nov 2026, the smaller set)
 * ============================================================================
 *
 * Ported from the sibling app (Glowbrands1/Ask-bubbles#475). QA's live run there with CA_SALES_POLICY_ENABLED +
 * REPLY_MATCHES_CARD_ENABLED + TITLE_OF_THE_EMPLOYEE_ENABLED (+ the glossary),
 * 3/3 runs, mgr-1-roster-first-initial: "I need a corrective action verbal for
 * <first name> <last initial>. This is for Under Performance on PPTA, LPSVA,
 * Club Average, Club Close %, and Spa %." replied "Which of them is this
 * Corrective Action Form for — **Club Close**, **<first name>** or **Under**?".
 * With the flags off the metric CA is refused; with the six-flag set
 * FORM_NAME_FROM_ROSTER_ENABLED masked it: the guards that rule out a list item
 * or a word of the offense ("Under Performance") are all behind FORM_NAME.
 * METRIC_GUARD_ENABLED runs those two whatever FORM_NAME says.
 *
 * The person is invented (checked against both apps' directories).
 */

type T = ReplayContext;

const PERPETUA: DirectoryRow = {
  id: "e-perpetua-thornquist",
  firstName: "Perpetua",
  lastName: "Thornquist",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const SMALLER_SET = ["CHAT_GLOSSARY_ENABLED", "CA_SALES_POLICY_ENABLED", "REPLY_MATCHES_CARD_ENABLED", "TITLE_OF_THE_EMPLOYEE_ENABLED"];
const REPORT = "the sibling app's LIVE=1, 5 Nov 2026 (the smaller set, 3/3 runs): a metrics CA for a person typed short offered metrics as people";
const say = (name: string) =>
  `I need a corrective action verbal for ${name}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`;
const METRIC_AS_PERSON = /\*\*(?:Club Close|Club Average|Under|Spa|PPTA|LPSVA)\*\*/i;

function start(t: T) {
  for (const flag of SMALLER_SET) vi.stubEnv(flag, "true");
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory([...STAFF, PERPETUA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV5_METRIC_GUARD_CASES: ReplayCase[] = [
  ...(
    [
      ["first-initial", "Perpetua T"],
      ["first-name", "Perpetua"],
    ] as const
  ).map(
    ([shape, typed]): ReplayCase => ({
      id: `nov5-metric-guard-${shape}`,
      title: `the smaller set: "${say(typed).slice(0, 60)}…": no metric is the card's employee or offered as a person`,
      report: `${REPORT}; typed "${typed}"`,
      // Here (unlike the sibling app's stand-ins) replay builds the live failure: with the smaller set the card is for **Club Close**.
      // Changed on purpose (7 Nov 2026): QA's flips of 5 and 6 Nov turned CA_SALES_POLICY, REPLY_MATCHES_CARD, TITLE_OF_THE_EMPLOYEE, METRIC_GUARD, TITLE_ENDS_AT_LINE, BARE_NOT_DENIAL and PLACE_FROM_CUE on in production (production-flags.json); both shapes now hold with production's flags.
      status: "fixed",
      fixFlags: ["METRIC_GUARD_ENABLED"],
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(say(typed));
        const card = thread.proposal?.employeeName ?? "";
        expect(card, `a metric is the card's employee:\n${reply.content}`).not.toMatch(/club close|club average|^under$|ppta|lpsva|^spa$/i);
        expect(reply.content, `a metric is offered as a person:\n${reply.content}`).not.toMatch(METRIC_AS_PERSON);
      },
    }),
  ),
  {
    id: "nov5-metric-guard-metrics-only",
    title: "the smaller set: \"CA for under performance on Club Close % and Spa %\" (no name): no card for \"under\" or \"Club Close\"; it asks who",
    report: `${REPORT}; the gate's twin (5 Nov 2026): nov4-pau-metrics-not-people-metrics-only and nov5-request-slot-metrics-only hold with production's flags and fail with the smaller set (a card for **under**)`,
    // Changed on purpose (7 Nov 2026): QA's flips of 5 and 6 Nov turned CA_SALES_POLICY, REPLY_MATCHES_CARD, TITLE_OF_THE_EMPLOYEE, METRIC_GUARD, TITLE_ENDS_AT_LINE, BARE_NOT_DENIAL and PLACE_FROM_CUE on in production (production-flags.json); this case now holds with production's flags.
    status: "fixed",
    fixFlags: ["METRIC_GUARD_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("CA for under performance on Club Close % and Spa %");
      expect(thread.proposal?.employeeName ?? "", `a metric is the card's employee:\n${reply.content}`).not.toMatch(/^under$|club close|spa/i);
      expect(reply.content, `a metric is offered as a person:\n${reply.content}`).not.toMatch(/\*\*(?:under|Club Close|Spa)\*\*/i);
      expect(reply.content, `does not ask who:\n${reply.content}`).toMatch(/Who is this|employee'?s full name/i);
    },
  },
  {
    id: "nov5-metric-guard-full-name-kept",
    title: "negative control, the smaller set: the same message for \"Perpetua Thornquist\" is her card",
    report: `${REPORT}; negative control`,
    status: "fixed",
    fixFlags: ["METRIC_GUARD_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(say("Perpetua Thornquist"));
      expect(thread.proposal?.employeeName, `not her card:\n${reply.content}`).toBe("Perpetua Thornquist");
      expect(reply.content, `a metric is offered as a person:\n${reply.content}`).not.toMatch(METRIC_AS_PERSON);
    },
  },
  /*
   * Found by this port's side-effect run (5 Nov 2026): with the smaller set and METRIC_GUARD on, QA's
   * off-roster probe "QA Probe XZT One" is taken off the card, and REPLY_MATCHES_CARD's rule 1
   * (`roster-only-names.ts` withoutUnseatedName) replaces each word of the name the reply drafted for, in any
   * case, so the app's own "One more question: **Is payroll deduct applicable?**" reads "The employee more
   * question". The guard only exposes it (without it the reply takes another path); the scrub is the
   * reply step's. QA's own probe wording (no real person). Changed on purpose (5 Nov 2026): fixed by the
   * scrub's ownWords (ported from Ask-bubbles#478 in this same PR), so the case is now "fixed".
   */
  {
    id: "nov5-metric-guard-reply-keeps-own-words",
    title: "the smaller set + METRIC_GUARD: an off-roster name ending in a common word (\"QA Probe XZT One\") never rewrites the app's own \"One more question\"",
    report: "this port's side-effect run (5 Nov 2026): nov4-qa-off-roster-name-with-one, \"The employee more question\"",
    status: "fixed",
    async run(t) {
      vi.stubEnv("METRIC_GUARD_ENABLED", "true");
      const thread = start(t);
      const reply = await thread.say(say("QA Probe XZT One"));
      expect(reply.content, `the app's own words were scrubbed:\n${reply.content}`).not.toMatch(/The employee more question/);
    },
  },
];

