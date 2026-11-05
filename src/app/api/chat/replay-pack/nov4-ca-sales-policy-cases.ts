import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CLIENT REQUEST (4 Nov 2026): SALES / MSB CORRECTIVE ACTIONS CITE THE
 * STANDARDS OF CONDUCT (CA_SALES_POLICY_ENABLED, default off)
 * ============================================================================
 *
 * Ported from Ask Bubbles #422. A Corrective Action for sales underperformance
 * or for MSB (Must See Behaviors) was created with no policy. Every such CA
 * must cite the manual's Standards of Conduct, with the heading and page of the
 * retrieved section and no invented quote. Negative controls: an attendance CA
 * cites Attendance; a cleaning CA does not cite the Standards of Conduct.
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

const SAFFIRA = person("e-saffira-tolleston", "Saffira", "Tolleston");
const GARRICK = person("e-garrick-wendlemoor", "Garrick", "Wendlemoor");
const ILSABET = person("e-ilsabet-harrowgate", "Ilsabet", "Harrowgate");
const BETTINA = person("e-bettina-crossfield", "Bettina", "Crossfield");
const ANSELM = person("e-anselm-fenwright", "Anselm", "Fenwright");

const PEOPLE: readonly DirectoryRow[] = [SAFFIRA, GARRICK, ILSABET, BETTINA, ANSELM];

/**
 * The invented people of this file; `ca-sales-policy.test.ts` checks none is
 * on another fixture. A function, not an array: the pack's registry reads
 * every exported array as cases.
 */
export function caSalesPolicyPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const ROSTER: readonly DirectoryRow[] = [...STAFF, ...PEOPLE];

const REPORT = "Client request relayed by Pau, 4 Nov 2026 (part B, Corrective Action policy)";
const FLAG = "CA_SALES_POLICY_ENABLED";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory(ROSTER);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** The draft cites the manual's Standards of Conduct by heading and page. */
function citesStandardsOfConduct(values: Record<string, string>): void {
  expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
  expect(values.policy_language ?? "", "Direct policy does not name the Standards of Conduct").toMatch(/standards of conduct/i);
  expect(values.policy_language ?? "", "Direct policy has no page").toMatch(/\bp(?:age|\.)\s*\d+/i);
}

export const NOV4_CA_SALES_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov4-ca-sales-msb",
    title: "a CA for MSB (Must See Behaviors) cites the Standards of Conduct, heading and page",
    report: `${REPORT}: (a) a CA for MSB`,
    // Before FORM_NAME_FROM_ROSTER_ENABLED and CA_SALES_POLICY_ENABLED were on together in production (5 Nov 2026): OPEN, no policy is cited for an MSB corrective action
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a corrective action for Saffira Tolleston for MSB");
      expect(thread.proposal, `no CA card for Saffira Tolleston:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Saffira Tolleston" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      t.draftWrites(
        { observation: "Observed:\nSaffira Tolleston did not perform the Must See Behaviors with guests during her shifts this week." },
        { offense_type: ["under_performance"] },
      );
      const id = await thread.create();
      citesStandardsOfConduct(t.values(id));
      expect(t.checked(id).offense_type ?? [], "Type of Offense is not Standards of Conduct").toEqual(["standards_of_conduct"]);
    },
  },
  {
    id: "nov4-ca-sales-low-sales",
    title: "a CA for low sales / not hitting goals cites the Standards of Conduct, heading and page",
    report: `${REPORT}: (b) a CA for low sales, not hitting goals`,
    /*
     * Turn 1 got no card at all: a metric with no behaviour was answered with
     * the progression ("I won't open formal corrective action off a metric").
     * Pau, 4 Nov 2026 (Ask Bubbles #426): under CA_SALES_POLICY_ENABLED a
     * stated sales shortfall goes to the form (`correctiveActionBasis`,
     * corrective-action-intake.ts).
     */
    // Before FORM_NAME_FROM_ROSTER_ENABLED and CA_SALES_POLICY_ENABLED were on together in production (5 Nov 2026): OPEN, no card: a low-sales request is answered with the progression (metric only), so no policy is cited
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("write a corrective action for Garrick Wendlemoor, his sales are low and he is not hitting his goals");
      expect(thread.proposal, `no CA card for Garrick Wendlemoor:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Garrick Wendlemoor" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      t.draftWrites(
        { observation: "Observed:\nGarrick Wendlemoor's sales were below his goals for October." },
        { offense_type: ["under_performance"] },
      );
      const id = await thread.create();
      citesStandardsOfConduct(t.values(id));
    },
  },
  {
    id: "nov4-ca-sales-wrong-items",
    title: "a CA for ringing up the wrong items cites the Standards of Conduct, heading and page",
    report: `${REPORT}: (c) a CA for wrong items rung up`,
    /*
     * THE DRAFT ONLY. The drafting model is told (CA_SALES_POLICY_RULE) that a
     * sale rung up inaccurately is the Standards of Conduct, and an Under
     * Performance tick becomes it. The card is the next case, still open.
     */
    // Fixed by Corrective Action revision 8 (template approved 4 Nov 2026): the Under Performance tick is the Standards of Conduct box on the current form, flag or not.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a corrective action for Ilsabet Harrowgate for ringing up the wrong items on a guest's sale");
      expect(thread.proposal, `no CA card for Ilsabet Harrowgate:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Ilsabet Harrowgate" });
      // The drafting model's offense_basis (CA_SALES_POLICY_ENABLED's optional tool field; Pau, 4 Nov 2026: wrong items keeps the Standards of Conduct, `ca-conduct-reason.ts`).
      t.draftWrites(
        { observation: "Observed:\nIlsabet Harrowgate rang up the wrong items on a guest's sale." },
        { offense_type: ["under_performance"] },
        { offense_basis: "sales" },
      );
      const id = await thread.create();
      citesStandardsOfConduct(t.values(id));
    },
  },
  {
    id: "nov4-ca-sales-wrong-items-card",
    title: "a CA for ringing up the wrong items: the card cites the Standards of Conduct",
    report: `${REPORT}: (c) a CA for wrong items rung up, the card`,
    /*
     * NO fixFlags YET (as in Ask Bubbles). At card time nothing reads the
     * form's offense type: the card's policy comes from the manager's words
     * alone, and a register mistake matches no offense-type reading or glossary
     * term. Covering it needs either the offense type read at card time (a
     * model reading) or a word list, which the request rules out. Asked via QA,
     * 4 Nov 2026.
     */
    status: { open: "the card cites no policy for a register-accuracy corrective action" },
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a corrective action for Ilsabet Harrowgate for ringing up the wrong items on a guest's sale");
      expect(thread.proposal, `no CA card for Ilsabet Harrowgate:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Ilsabet Harrowgate" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
    },
  },
  {
    id: "nov4-ca-sales-negative-no-reason",
    title: "negative control: a vague \"make a CA for him\" with no reason still asks for the reason, and cites nothing",
    report: `${REPORT}: negative control, no reason given`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("make a CA for Garrick Wendlemoor");
      expect(policyLine(reply), `the card cites a policy with no reason given:\n${reply.content}`).not.toMatch(/standards of conduct/i);
      expect(reply.content, `no question for what happened:\n${reply.content}`).toMatch(/\?/);
    },
  },
  {
    id: "nov4-ca-sales-negative-attendance",
    title: "negative control: an attendance CA cites Attendance, never the Standards of Conduct",
    report: `${REPORT}: negative control, attendance`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a corrective action for Bettina Crossfield, she was late to her shift three times this week");
      expect(thread.proposal, `no CA card for Bettina Crossfield:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Bettina Crossfield" });
      expect(policyLine(reply), `the card cites Standards of Conduct for attendance:\n${reply.content}`).not.toMatch(/standards of conduct/i);
      t.draftWrites({ observation: "Observed:\nBettina Crossfield arrived late to three shifts this week." }, { offense_type: ["tardiness"] });
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated is Standards of Conduct").not.toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy does not cite Attendance").toMatch(/attendance/i);
    },
  },
  {
    id: "nov4-ca-sales-negative-cleaning",
    title: "negative control: a cleaning CA does not cite the Standards of Conduct by default",
    report: `${REPORT}: negative control, cleaning`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("make a corrective action for Anselm Fenwright, the tanning beds were left dirty at close");
      expect(thread.proposal, `no CA card for Anselm Fenwright:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Anselm Fenwright" });
      expect(policyLine(reply), `the card cites Standards of Conduct for cleaning:\n${reply.content}`).not.toMatch(/standards of conduct/i);
      t.draftWrites({ observation: "Observed:\nThe tanning beds were left dirty at close." });
      const id = await thread.create();
      expect(t.values(id).policy_violated ?? "", "Policy Violated is Standards of Conduct").not.toMatch(/standards of conduct/i);
    },
  },
];
