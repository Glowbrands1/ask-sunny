import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noRepeatedReply, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PAU, 4 NOV 2026 / OVERNIGHT SCAN sf-s19: METRICS READ AS PEOPLE
 * (FORM_NAME_FROM_ROSTER_ENABLED, step 5's first piece, default off)
 * ============================================================================
 *
 * "I need a corrective action verbal for <name>. This is for Under Performance
 * on PPTA, LPSVA, Club Average, Club Close %, and Spa %."
 *
 * Ported from Ask Bubbles, where the reply said "I couldn't find **Club
 * Close** or **Under** in the Woven roster" and both were stripped from the
 * question, so the card cited no policy. Here, with production's flags, the
 * message is answered as metric-only (no card); with CA_SALES_POLICY_ENABLED
 * on the card is made and cites the Standards of Conduct, but the name reader
 * still takes "Club Close" and "Under" for people and the grounding step lists
 * them as unmatched (`forms/form-name-from-roster.test.ts` proves that part).
 * With the flag on, a candidate shaped like nobody on the scoped roster (no
 * roster first name for a 2+ word candidate, no roster first or last name for
 * one word) is not a name and is not unmatched, when the same message names
 * somebody on the roster. See `forms/roster-shape.ts`.
 * The flag needs CA_SALES_POLICY_ENABLED.
 *
 * The overnight scan's sf-s19 (`nov4-overnight-scan-cases.ts`) is the same
 * message; it stays OPEN without this flag in its fixFlags (turn 2, "Corrective
 * Action", is its own fault).
 *
 * Only beside somebody on the roster (the middle ground, QA 4 Nov 2026): a
 * message that names nobody on the roster is read as before.
 *
 * Negative controls: a typo of a roster person still gets the close-match
 * question; a full name nobody on the roster shares, typed alone, is never the
 * card's employee, with the flag or without; metric words with no roster name
 * beside them are read as before (the metrics-only case).
 *
 * Every person is invented (the repository is public) and is on this file's
 * own directory fixture only.
 */

type T = ReplayContext;

const SALON = "loc-0309";

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
});

const PERPETUA = person("e-perpetua-thornquist", "Perpetua", "Thornquist");
const LEOCADIA = person("e-leocadia-wexcombe", "Leocadia", "Wexcombe");

const ROSTER: readonly DirectoryRow[] = [...STAFF, PERPETUA, LEOCADIA];

const REPORT = "Pau, 4 Nov 2026 (sf-s19, metrics read as people): a CA for Under Performance on named metrics";
const FLAG = "FORM_NAME_FROM_ROSTER_ENABLED";
const SALES = "CA_SALES_POLICY_ENABLED";
const GLOSSARY = "CHAT_GLOSSARY_ENABLED";

/** Pau's message, word for word, with an invented employee. */
const say = (name: string) =>
  `I need a corrective action verbal for ${name}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory(ROSTER);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

export const NOV4_METRICS_NOT_PEOPLE_CASES: ReplayCase[] = [
  {
    id: "nov4-pau-metrics-not-people",
    title: "sf-s19: Pau's Under Performance CA on PPTA, LPSVA, Club Average, Club Close %, Spa %: no roster note, the card cites Standards of Conduct",
    report: `${REPORT}: "I need a corrective action verbal for <name>. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."`,
    status: { open: "no card: production answers the message as metric-only (CA_SALES_POLICY_ENABLED off)" },
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(say("Perpetua Thornquist"));
      expect(reply.content, `a metric is announced as a missing person:\n${reply.content}`).not.toMatch(/couldn't find/i);
      expect(reply.content, `"Club Close" or "Under" is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Under)\*\*/);
      expect(thread.proposal, `no CA card for Perpetua Thornquist:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Perpetua Thornquist" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      t.draftWrites(
        { observation: "Observed:\nPerpetua Thornquist was below goal on PPTA, LPSVA, Club Average, Club Close % and Spa % this period." },
        { offense_type: ["under_performance"] },
      );
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy does not name the Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.employee_name ?? "", "the form's employee is not Perpetua Thornquist").toMatch(/Perpetua Thornquist/);
    },
  },
  {
    id: "nov4-pau-metrics-not-people-typo",
    title: "negative control: a typo of a roster person on the same message still gets the close-match question",
    report: `${REPORT}: negative control, a typo of a roster name`,
    status: { open: "no card or question: production answers the message as metric-only (CA_SALES_POLICY_ENABLED off)" },
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(say("Leocadia Wexcomb"));
      const said = `${reply.content}\n${JSON.stringify(thread.proposal)}`;
      expect(said, `no close-match note for Leocadia Wexcombe:\n${said}`).toMatch(/Leocadia Wexcombe/);
      expect(reply.content, `a metric is announced as a missing person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Under)\*\*/);
    },
  },
  {
    id: "nov4-pau-metrics-not-people-unknown",
    title: "negative control: a full name nobody on the roster shares, typed alone, is never the card's employee, and no metric is",
    report: `${REPORT}: negative control, a person not on the roster`,
    status: "fixed",
    /*
     * Unlike Ask Bubbles, this app never says "I couldn't find … in the Woven
     * roster": with the sales policy on, the flag or not, the reply asks "Who is
     * this form for?". Nobody in this message is on the roster, so under the
     * middle ground (QA, 4 Nov 2026) it is read exactly as before.
     */
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(say("Zuleika Brightwell"));
      expect(thread.proposal?.employeeName ?? "", "an unknown person or a metric is on the card").not.toMatch(/Zuleika|Club Close|^Under$/);
      expect(reply.content, `"Club Close" or "Under" is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Under)\*\*/);
      // Said again, the chat moves on: not the same reply word for word (no loop).
      const again = await thread.say("Zuleika Brightwell");
      noRepeatedReply([reply, again]);
    },
  },
  {
    id: "nov4-pau-metrics-not-people-metrics-only",
    title: "metrics with no roster name (\"CA for under performance on Club Close % and Spa %\"): no metric is the employee or said back as a person, flag on or off",
    report: `${REPORT}: metric words with no roster name beside them`,
    /*
     * QA, 4 Nov 2026: report it, don't hide it. Nothing in the message names
     * somebody on the roster, so the middle ground reads it as before.
     *
     * NO fixFlags, ON PURPOSE: it does NOT hold with the sales policy on. With
     * CA_SALES_POLICY_ENABLED (and CHAT_GLOSSARY_ENABLED), with or without
     * FORM_NAME_FROM_ROSTER_ENABLED, the card is made "for **under**" — the
     * "under" of "for under performance" becomes the card's employee. With
     * production's flags the message is answered as metric-only (no card), so
     * this holds. Put to Pau, 4 Nov 2026. The grounding step's reading is
     * pinned in `forms/form-name-from-roster.test.ts`.
     */
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("CA for under performance on Club Close % and Spa %");
      expect(reply.content, `a metric is announced as a missing person:\n${reply.content}`).not.toMatch(/couldn't find/i);
      expect(thread.proposal?.employeeName ?? "", "a metric is on the card").not.toMatch(/under|club close/i);
    },
  },
];
