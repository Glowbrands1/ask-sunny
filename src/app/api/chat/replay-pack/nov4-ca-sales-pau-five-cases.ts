import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PAU'S FIVE MESSAGES (4 Nov 2026): WHAT CA_SALES_POLICY_ENABLED MUST PASS
 * ============================================================================
 *
 * Before CA_SALES_POLICY_ENABLED can stay on, these exact manager messages
 * (relayed by QA, names invented) must make the Corrective Action card, never
 * ask "what happened" when the metrics or the reason are given, never read
 * MSB as a name, and cite the Standards of Conduct with the manual's heading
 * and page. Every person is invented and on this file's own fixture.
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

const ROSALIND = person("e-ysolde-marrowick", "Ysolde", "Marrowick");
const TOBIAH = person("e-thaddeus-quillane", "Thaddeus", "Quillane");
const MERIEL = person("e-briony-fellwater", "Briony", "Fellwater");
const CASSIAN = person("e-osric-vantablade", "Osric", "Vantablade");
const PEOPLE: readonly DirectoryRow[] = [ROSALIND, TOBIAH, MERIEL, CASSIAN];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function pauFivePeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const FLAGS = ["CA_SALES_POLICY_ENABLED", "CHAT_GLOSSARY_ENABLED"];
const REPORT = "Pau, 4 Nov 2026 (relayed by QA): the five messages CA_SALES_POLICY_ENABLED must pass";
const ASKS_WHAT_HAPPENED = /haven'?t told me what happened|what happened\?|tell me what happened/i;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** A CA card for `name` that cites the Standards of Conduct and does not ask what happened. */
function citesConduct(thread: ReturnType<T["thread"]>, reply: ReplayAnswer, name: string): void {
  expect(thread.proposal, `no CA card for ${name}:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: name });
  expect(reply.content, `asks what happened although the reason was given:\n${reply.content}`).not.toMatch(ASKS_WHAT_HAPPENED);
  expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
}

/** The draft cites the Standards of Conduct by the manual's heading and page. */
async function draftCitesConduct(t: T, thread: ReturnType<T["thread"]>, observation: string): Promise<void> {
  t.draftWrites({ observation: `Observed:\n${observation}` }, { offense_type: ["standards_of_conduct"] });
  const id = await thread.create();
  const values = t.values(id);
  expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
  expect(values.policy_language ?? "", "Direct policy does not cite the Standards of Conduct").toMatch(/standards of conduct/i);
  expect(values.policy_language ?? "", "Direct policy has no page").toMatch(/\bp(?:age|\.)\s*\d+/i);
}

export const NOV4_PAU_FIVE_CASES: ReplayCase[] = [
  {
    id: "nov4-pau5-1-verbal-under-performance-metrics",
    title: "1. \"I need a corrective action verbal for … This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.\"",
    report: `${REPORT}, #1`,
    /*
     * NO fixFlags YET. The name reader takes "Club Close" and "Under" for people
     * ("I couldn't find **Club Close** or **Under** in the Woven roster") and
     * drops them from the text the policy is read from, so the stated shortfall
     * is gone and no policy is cited. Same root cause as nov4-scan-sf-s19
     * (metrics read as people), queued for the Success session's names step.
     * The reading itself is right: ca-sales-policy.test.ts, #1's exact words.
     */
    status: { open: "the metrics \"Club Close\" and \"Under\" are read as names and dropped, so the card cites no policy" },
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a corrective action verbal for Ysolde Marrowick. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      citesConduct(thread, reply, "Ysolde Marrowick");
      await draftCitesConduct(t, thread, "Ysolde Marrowick was below target on PPTA, LPSVA, Club Average, Club Close % and Spa %.");
    },
  },
  {
    id: "nov4-pau5-2-ca-for-msb",
    title: "2. \"I need to make a corrective action for msb\": MSB is never the employee; the one question is who it is for",
    report: `${REPORT}, #2`,
    status: { open: "\"msb\" is looked up as a person with production's flags" },
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need to make a corrective action for msb");
      expect(reply.content, `MSB is read as a name:\n${reply.content}`).not.toMatch(/couldn'?t find \*\*msb\*\*|\*\*Msb\*\*/i);
      expect(thread.proposal?.employeeName ?? "", "MSB was saved as the employee").not.toMatch(/msb/i);
      expect(reply.content, `asks what happened although the reason (MSB) was given:\n${reply.content}`).not.toMatch(ASKS_WHAT_HAPPENED);
      // QA, live, 4 Nov 2026 (conv_mw2ds90h2wk2bgz): the nameless card's Observation of Offense was "msb".
      expect(reply.content, `MSB is the Observation of Offense:\n${reply.content}`).not.toMatch(/\*\*Observation of Offense:\*\*\s*msb\b/i);
      const named = await thread.say("Thaddeus Quillane");
      citesConduct(thread, named, "Thaddeus Quillane");
    },
  },
  {
    id: "nov4-pau5-3-under-performance-salon-metrics",
    title: "3. \"CA for … due to under performance in salon metrics\"",
    report: `${REPORT}, #3`,
    // Holds with production's flags since Corrective Action revision 8 (#512): Under Performance is the Standards of Conduct.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("CA for Briony Fellwater due to under performance in salon metrics");
      citesConduct(thread, reply, "Briony Fellwater");
      await draftCitesConduct(t, thread, "Briony Fellwater under performed in the salon metrics.");
    },
  },
  {
    id: "nov4-pau5-4-msb-ca-underperformance-october",
    title: "4. \"MSB CA for … for underperformance in the month of October\"",
    report: `${REPORT}, #4`,
    status: { open: "with production's flags the CA is not cited as the Standards of Conduct" },
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("MSB CA for Osric Vantablade for underperformance in the month of October");
      expect(thread.proposal?.employeeName ?? "", "MSB was saved as the employee").not.toMatch(/msb/i);
      citesConduct(thread, reply, "Osric Vantablade");
      await draftCitesConduct(t, thread, "Osric Vantablade did not perform the Must See Behaviors in October.");
    },
  },
  {
    id: "nov4-pau5-5-must-see-behaviors-violates-soc",
    title: "5. \"… did not follow must see behaviors which violates standards of conduct policy\": asks once \"Do you want a Corrective Action for <name>?\"; the card opens only on \"yes\"",
    report: `${REPORT}, #5`,
    /*
     * Pau, 4 Nov 2026: NO routing change — a message with no request stays a
     * policy answer. With CA_SALES_POLICY_ENABLED the answer ends with one
     * offer to start a Corrective Action for the employee the roster knows,
     * citing the policy; no card until the manager says yes (`ca-offer.ts`).
     */
    status: { open: "no offer: the policy answer ends without offering a Corrective Action" },
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("Ysolde Marrowick did not follow must see behaviors which violates standards of conduct policy");
      expect(thread.proposal ?? null, `a card was made with no request:\n${reply.content}`).toBeNull();
      expect(reply.content, `the answer does not offer the Corrective Action citing the Standards of Conduct:\n${reply.content}`).toMatch(
        /\*\*Do you want a Corrective Action for Ysolde Marrowick\?\*\*[^\n]*\*\*Standards of Conduct\*\*/,
      );
      expect(reply.content.match(/Do you want a Corrective Action for/g) ?? [], "asked more than once").toHaveLength(1);
      const yes = await thread.say("yes");
      citesConduct(thread, yes, "Ysolde Marrowick");
      await draftCitesConduct(t, thread, "Ysolde Marrowick did not follow the Must See Behaviors.");
    },
  },
  {
    id: "nov4-pau5-5b-negative-general-policy-question",
    title: "negative control for #5: a general policy question with no employee named gets no offer",
    report: `${REPORT}, #5 negative control`,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("what does the standards of conduct policy say about must see behaviors?");
      expect(reply.content, `an offer with no employee named:\n${reply.content}`).not.toMatch(/Do you want a Corrective Action for/);
      expect(thread.proposal ?? null, "a card was made").toBeNull();
    },
  },
];
