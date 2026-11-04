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
 * Ported from the sibling app, where the reply said "I couldn't find **Club
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
 * beside them are read as before, except that one lowercase word that is
 * nobody on the roster ("under") is never the employee (the metrics-only
 * case); a roster first name typed in lowercase is still matched.
 *
 * Every person is invented (the repository is public). Corin Bellweather is
 * QA's pau-1 person, shared with `nov4-live-regressions-scenarios.ts`; the
 * others are on this file's own directory fixture only.
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
/** QA's pau-1 person (`nov4-live-regressions-scenarios.ts`), invented. */
const CORIN = person("e-corin-bellweather", "Corin", "Bellweather");

const ROSTER: readonly DirectoryRow[] = [...STAFF, PERPETUA, LEOCADIA, CORIN];

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
    // Before CA_SALES_POLICY_ENABLED was on in production (on in this app since 4 Nov 2026, 17:08 UTC): OPEN, no card: production answers the message as metric-only (CA_SALES_POLICY_ENABLED off)
    status: "fixed",
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
    // Before CA_SALES_POLICY_ENABLED was on in production (on in this app since 4 Nov 2026, 17:08 UTC): OPEN, no card or question: production answers the message as metric-only (CA_SALES_POLICY_ENABLED off)
    status: "fixed",
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
     * Unlike the sibling app, this app never says "I couldn't find … in the Woven
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
    title: "metrics with no roster name (\"CA for under performance on Club Close % and Spa %\"): no card for \"under\"; it asks who the form is for",
    report: `${REPORT}: metric words with no roster name beside them`,
    /*
     * With CA_SALES_POLICY_ENABLED on, the card was made "for **under**": the
     * "under" of "for under performance" became the card's employee, with or
     * without the middle ground. Approved (QA for Pau, 4 Nov 2026): one word
     * typed all in lowercase that is nobody's first, preferred or last name on
     * the roster is never the employee (`forms/roster-shape.ts`
     * lowercaseNobody).
     *
     * With CA_SALES_POLICY_ENABLED on in production (since 4 Nov 2026, 17:08
     * UTC) and FORM_NAME_FROM_ROSTER_ENABLED still off, production makes the
     * card "for **under**": OPEN until FORM_NAME_FROM_ROSTER_ENABLED is on.
     * (Before the sales flip it held: production answered metric-only, no card.)
     */
    status: { open: 'with CA_SALES_POLICY_ENABLED on in production, the card is made "for **under**"' },
    fixFlags: [SALES, FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("CA for under performance on Club Close % and Spa %");
      expect(reply.content, `a metric is announced as a missing person:\n${reply.content}`).not.toMatch(/couldn't find/i);
      expect(reply.content, `"under" is named as the employee:\n${reply.content}`).not.toMatch(/\*\*under\*\*/i);
      expect(thread.proposal?.employeeName ?? "", "a metric is on the card").not.toMatch(/under|club close/i);
      if (thread.proposal) expect(reply.content, `a card with no employee does not ask who it is for:\n${reply.content}`).toMatch(/Who is this (?:\*\*[^*]+\*\* |form )?for\?/);
    },
  },
  {
    id: "nov4-pau-metrics-not-people-lowercase-roster-name",
    title: "negative control: a roster first name typed alone in lowercase (\"perpetua\"), answering who the form is for, is still matched",
    report: `${REPORT}: negative control, a lowercase roster first name`,
    // Before CA_SALES_POLICY_ENABLED was on in production (on in this app since 4 Nov 2026, 17:08 UTC): OPEN, production answers turn 1 as metric-only (CA_SALES_POLICY_ENABLED off), so there is no form for \"perpetua\" to answer
    status: "fixed",
    fixFlags: [SALES, FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("CA for under performance on Club Close % and Spa %");
      const reply = await thread.say("perpetua");
      const said = `${reply.content}\n${JSON.stringify(thread.proposal)}`;
      expect(said, `"perpetua" is not matched to Perpetua Thornquist:\n${said}`).toMatch(/Perpetua Thornquist/);
    },
  },
  {
    id: "nov4-pau-metrics-not-people-lowercase-first-name",
    title: "Pau's message with the first name typed in lowercase (\"for perpetua\"): Perpetua Thornquist, never a \"Club Close\" card; Standards of Conduct cited",
    report: `${REPORT}: "I need a corrective action verbal for perpetua. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."`,
    /*
     * Approved by QA, 4 Nov 2026: a single lowercase word that is somebody's
     * first or preferred name on the roster anchors the message
     * (`forms/roster-shape.ts` lowercaseRosterFirstNameIn), so "Club Close"
     * and "Under" are set aside. Before, the card was made "for **Club
     * Close**" with these flags on.
     */
    status: { open: "production answers the message as metric-only (CA_SALES_POLICY_ENABLED off)" },
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a corrective action verbal for perpetua. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      expect(reply.content, `"Club Close" or "Under" is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Under)\*\*/i);
      expect(thread.proposal?.employeeName ?? "", "a metric is on the card").not.toMatch(/club close|^under$/i);
      const said = `${reply.content}\n${JSON.stringify(thread.proposal)}`;
      expect(said, `neither a card for Perpetua Thornquist nor "Is this for Perpetua Thornquist?":\n${said}`).toMatch(/Perpetua Thornquist/);
      if (thread.proposal?.employeeName === "Perpetua Thornquist") {
        expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      } else {
        const confirmed = await thread.say("yes");
        expect(thread.proposal, `no CA card for Perpetua Thornquist after "yes":\n${confirmed.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Perpetua Thornquist" });
        expect(policyLine(confirmed), `the card does not cite Standards of Conduct:\n${confirmed.content}`).toMatch(/standards of conduct/i);
      }
    },
  },
  {
    id: "nov4-pau-metrics-not-people-pau-1-lowercase-full-name",
    title: "negative control: QA's pau-1 wording, a lowercase full name (\"corin bellweather\") on the roster, is still the card's employee",
    report: `${REPORT}: negative control, QA's pau-1 wording`,
    status: "fixed",
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      await thread.say("Corrective action: corin bellweather was rude to a guest at the front desk on Monday");
      expect(thread.proposal, "no CA card for Corin Bellweather").toMatchObject({ templateKey: "dpoa", employeeName: "Corin Bellweather" });
    },
  },
  {
    /*
     * QA, 4 NOV 2026: live, Pau's message 1 for the QA test account's own
     * roster entry. The reply said "I'll draft a Corrective Action Form for
     * <the entry's name>" and the card's Employee was empty ("Not yet — tell
     * Sunny who this form is about"). Not the shared-login or self exclusion:
     * the slot keeper (`ai/keep-filled-slots.ts` keptName) read the name as a
     * fragment for its word "one" and dropped it, after the reply sentence was
     * written. KEEP_ROSTER_EXACT_NAME_ENABLED: an exact roster name is kept.
     * The entry here is invented, with the same shape (two short words, an
     * all-capitals word, "One").
     */
    id: "nov4-qa-roster-name-with-one",
    title: "QA 4 Nov: Pau's message 1 for a roster person whose name ends in \"One\": the card's employee is the name the reply drafts for",
    report: `QA, 4 Nov 2026: "I need a corrective action verbal for <QA test account>. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %." → "I'll draft … for <name>", card Employee empty`,
    status: { open: "the reply drafts for the name and the card's employee is empty (or, with CA_SALES_POLICY_ENABLED off, no card)" },
    fixFlags: ["KEEP_ROSTER_EXACT_NAME_ENABLED", SALES, GLOSSARY],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, person("e-qa-probe-xzt-one", "QA Probe", "XZT One")]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(say("QA Probe XZT One"));
      const drafting = /draft a \*\*[^*]+\*\* for \*\*([^*]+)\*\*/i.exec(reply.content)?.[1] ?? null;
      expect(thread.proposal?.employeeName ?? null, `the card's employee is not QA Probe XZT One:\n${reply.content}`).toBe("QA Probe XZT One");
      if (drafting) expect(drafting, "the reply drafts for a name the card does not hold").toBe(thread.proposal?.employeeName);
    },
  },
  {
    /*
     * Negative control: the same message for a name with "One" in it that is
     * NOT on the roster. The grounding step already leaves it off the card and
     * the reply asks who (it never drafts "for **<name>**" over an empty
     * Employee) — with production's flags and with the keeper flag on.
     */
    id: "nov4-qa-off-roster-name-with-one",
    title: "QA 4 Nov: the same message for a name ending in \"One\" that is on no roster: a card with no employee never says it drafts for that name; it asks who",
    report: `QA, 4 Nov 2026: "I need a corrective action verbal for <QA test account>. …" → "I'll draft … for <name>", card Employee empty`,
    status: "fixed",
    fixFlags: ["KEEP_ROSTER_EXACT_NAME_ENABLED", SALES, GLOSSARY],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(say("QA Probe XZT One"));
      if (!thread.proposal) return; // CA_SALES_POLICY_ENABLED off: the metric-only answer, no card.
      expect(thread.proposal, `no card:\n${reply.content}`).toBeTruthy();
      if (thread.proposal?.employeeName) return;
      expect(reply.content, `the reply drafts for a name the card does not hold:\n${reply.content}`).not.toMatch(/\*\*QA Probe XZT One\*\*/);
      expect(reply.content, `a card with no employee does not ask who:\n${reply.content}`).toMatch(/Who is this (?:\*\*[^*]+\*\* |form )?for\?/);
    },
  },
];
