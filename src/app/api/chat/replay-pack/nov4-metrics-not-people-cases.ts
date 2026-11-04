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
    title: "negative control: a full name nobody on the roster shares, typed alone: no metric is the card's employee or named as a person",
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
      /*
       * CHANGED ON PURPOSE (step 5 part 2, QA for Pau, 5 Nov 2026): with the
       * request slot, "… for Zuleika Brightwell" is the message's one
       * candidate, so this app makes the card for the name as typed — QA's
       * accepted behaviour here. A metric is still never the employee.
       */
      expect(thread.proposal?.employeeName ?? "", "a metric is on the card").not.toMatch(/Club Close|^Under$/);
      expect(reply.content, `"Club Close" or "Under" is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Under)\*\*/);
      // Asked who, and the name said again: the chat moves on, not the same reply word for word (no loop).
      // With the card made (part 2) there is no question to loop on, so the second turn is not sent.
      if (!thread.proposal?.employeeName) {
        const again = await thread.say("Zuleika Brightwell");
        noRepeatedReply([reply, again]);
      }
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
     * lowercaseNobody). With production's flags the message is answered as
     * metric-only (no card), so this holds there too.
     */
    status: "fixed",
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
    status: { open: "production answers turn 1 as metric-only (CA_SALES_POLICY_ENABLED off), so there is no form for \"perpetua\" to answer" },
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
  /*
   * QA, 4 NOV 2026, 19:21 UTC: CA_SALES_POLICY_ENABLED rolled back in this
   * app. Live, a REAL roster employee (QA's "Employee R", never written),
   * Pau's message 1, CA_SALES on, FORM_NAME off: a card whose Employee was
   * "Club Close" (conv_mw2i2avm22egfhe). Here, with CA_SALES and the glossary
   * on and FORM_NAME off, a roster person typed by first name only, or by
   * first name and last initial, gets a card "for **Club Close**"; typed in
   * full (any case, hyphen, apostrophe, three words) the card is theirs. With
   * FORM_NAME on, the first name asks "Is this for Perpetua Thornquist?" and
   * the first name and initial asks the same (an initial that starts her
   * surname is her surname, `request-slot.ts` typedWithOtherSurname).
   */
  ...(
    [
      ["first-name", "Perpetua"],
      ["first-initial", "Perpetua T"],
    ] as const
  ).map(
    ([shape, typed]): ReplayCase => ({
      id: `nov4-qa-roster-${shape}-metrics-not-people`,
      title: `QA 4 Nov: Pau's message 1 for a roster Tanning Consultant typed "${typed}": the card is never "Club Close"; it is for Perpetua Thornquist or asks for her`,
      report: `QA, 4 Nov 2026 (Sunny CA_SALES rolled back): "I need a corrective action verbal for <Employee R>. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %." → card Employee "Club Close"`,
      status: { open: "production answers the message as metric-only, no card (CA_SALES_POLICY_ENABLED off); with CA_SALES on and FORM_NAME off the card is for \"Club Close\"" },
      fixFlags: [FLAG, SALES, GLOSSARY],
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(say(typed));
        const card = thread.proposal?.employeeName ?? "";
        expect(card, `a metric is the card's employee:\n${reply.content}`).not.toMatch(/club close|club average|^under$|ppta|lpsva|spa/i);
        expect(reply.content, `a metric is named as a person:\n${reply.content}`).not.toMatch(/\*\*(?:Club Close|Club Average|Under)\*\*/i);
        const asked = /Is this for \*\*Perpetua Thornquist\*\*\?/.test(reply.content);
        // Never the short name alone: "Perpetua T" made a card for "Perpetua" before the initial counted as her surname.
        expect(card === "Perpetua Thornquist" || asked, `neither a card for Perpetua Thornquist nor "Is this for Perpetua Thornquist?" (card ${JSON.stringify(card)}):\n${reply.content}`).toBe(true);
      },
    }),
  ),
  /*
   * QA, 4 NOV 2026, 19:21–19:41 UTC, production with CA_SALES_POLICY_ENABLED
   * OFF. The tester's "employee" was a form's name pasted where the person's
   * goes: the stored messages read "… for Coaching Form. …"
   * (conv_mw2i2avm22egfhe, conv_mw2ibcm02l42nya, conv_mw2idhu42wdjlet,
   * conv_mw2id8ky2do6is8). The named form wins (a Coaching Form card), so the
   * Corrective Action's metric-only answer never runs, and the next
   * capitalised phrase, "Club Close", became the employee: "Here is what I
   * would put on a **Coaching Form**. … I have the employee and the salon."
   * With FORM_NAME_FROM_ROSTER_ENABLED (which no longer needs the sales
   * policy), "Club Close" is a list item or outside the request slot, never a
   * candidate, and the card with no employee asks who. Exact wording.
   */
  ...(
    [
      ["b", "I need a corrective action for Coaching Form. This is for Under Performance on Club Close % and Spa %.", { open: "a Coaching Form card for \"Club Close\": \"I have the employee and the salon\"" }],
      ["p1", say("Coaching Form"), { open: "a Coaching Form card for \"Club Close\": \"I have the employee and the salon\"" }],
      // QA's (A): no metric in the message; production already asks who (the negative control).
      ["a", "Create a Corrective Action for Coaching Form", "fixed"],
    ] as const
  ).map(
    ([key, text, status]): ReplayCase => ({
      id: `nov4-qa-form-name-as-person-${key}`,
      title: `QA 4 Nov (CA_SALES off): "${text.slice(0, 60)}…": no metric is the employee; a card with no employee asks who`,
      report: `QA, 4 Nov 2026, production with CA_SALES off: "${text}"`,
      status,
      fixFlags: [FLAG],
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(text);
        const card = thread.proposal?.employeeName ?? "";
        expect(card, `a metric is the card's employee:\n${reply.content}`).not.toMatch(/club close|club average|^under$|ppta|lpsva|spa/i);
        expect(reply.content, `the reply says it has the employee:\n${reply.content}`).not.toMatch(/I have the employee/i);
        if (thread.proposal && !card) expect(reply.content, `a card with no employee does not ask who:\n${reply.content}`).toMatch(/Who is this (?:\*\*[^*]+\*\* |form )?for\?/);
      },
    }),
  ),
];
