import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A TILL SHORTAGE CITES THE REGISTER / BANK SHORTAGES LINE AND ITS PAGE, NOT THE HEADING'S (LOOP_CARD_CITES_CONDUCT_LINE)
 * ============================================================================
 *
 * QA's live test (24 Nov 2026, admin, global scope): "Draft a corrective action form for a till shortage for Test
 * Employee" made a loop card whose policy was the Standards of Conduct at the heading's page (p.12). The manual lists
 * "Register / Bank shortages" on its own line, on printed page 13, and the saved draft cites that line's page
 * (`withConductLinePage`); the loop only knew the bare heading (`topicHeadings`). With the flag on the card reads
 * "Standards of Conduct — Register / Bank shortages, JBA Policy Manual p.13", Create saves that line as Policy Violated,
 * and read_policy's source card is the line's page. "Test Employee" is QA's own test name, on no roster.
 */

const FIX = ["LOOP_CARD_CITES_CONDUCT_LINE_ENABLED"];
const STATUS = { open: "LOOP_CARD_CITES_CONDUCT_LINE_ENABLED is off in production (default off; QA flips it)" } as const;
const REPORT = "QA's live test (24 Nov 2026): \"Draft a corrective action form for a till shortage for Test Employee\" carded \"Standards of Conduct …, JBA Policy Manual p.12\", not the Register / Bank shortages line";
const SAID = "Draft a corrective action form for a till shortage for Test Employee";
const TEST_EMPLOYEE: DirectoryRow = { id: "e-test-employee", firstName: "Test", lastName: "Employee", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** The manual's listed lines inside the Standards of Conduct (wording as the production manual lists them), on printed page 13. */
const CONDUCT_LINES = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Insubordination -the refusal to follow the directions of the manager.\no Register / Bank shortages\no Theft, inappropriate removal or possession of company or customer property",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};

function setUp(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
  t.directory([...STAFF, TEST_EMPLOYEE]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas!([CONDUCT_LINES]);
}

function card(said: string, account: string, readFirst: boolean) {
  return loopStandIn((view): LoopDecision => {
    /* The reply cites the section it read, as a live reply does ([S#]), so its source card is shown. */
    if (lastResult(view, "propose_form")) return { text: `Here's the Corrective Action Form. ${String(lastResult(view, "read_policy")?.source ?? "")}`.trim() };
    if (readFirst && !lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: headingWith(view, /^standards of conduct$/i) } };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa", employee_id: TEST_EMPLOYEE.id, person_evidence: evidenceFrom(view, "Test Employee"),
        what_happened: account, incident_date: "2026-11-24", policy: headingWith(view, /^standards of conduct$/i),
      },
    };
  });
}

const policyOf = (t: { proposal: unknown }) => String((t.proposal as { policyLine?: string | null } | null)?.policyLine ?? "");

export const NOV24_AGENT_LOOP_CONDUCT_LINE_ON_CARD_CASES: ReplayCase[] = [
  {
    id: "nov24-loop-till-shortage-cites-register-bank-line",
    title: `"${SAID}": the card cites "Standards of Conduct — Register / Bank shortages, JBA Policy Manual p.13", and Create saves that line`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      t.loopModel!(card(SAID, "Till shortage for Test Employee.", false));
      const thread = t.thread();
      await thread.say(SAID);
      const line = policyOf(thread);
      expect(line, "the card's policy line").toBe("Standards of Conduct — Register / Bank shortages, JBA Policy Manual p.13");
      const id = await thread.create();
      expect(t.values(id).policy_violated, "the saved Policy Violated").toBe(line);
    },
  },
  {
    id: "nov24-loop-till-shortage-read-policy-source-is-the-line-page",
    title: `"${SAID}" (the model reads the Standards of Conduct first): the source card is the Register / Bank shortages line's page 13, never the heading's p.12`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      t.loopModel!(card(SAID, "Till shortage for Test Employee.", true));
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(policyOf(thread)).toMatch(/Register \/ Bank shortages, JBA Policy Manual p\.13$/);
      const titles = (reply.citations ?? []).map((citation) => JSON.stringify(citation));
      expect(titles.join("\n"), "the source cards").toMatch(/Page 13 — Standards of Conduct/);
      expect(titles.join("\n"), "the source cards").not.toMatch(/Page 12 — Standards of Conduct/);
    },
  },
  {
    id: "nov24-loop-insubordination-cites-its-line",
    title: "Same mechanism, another listed line: \"ca for Test Employee, she refused to do what I asked\" cites \"Standards of Conduct — Insubordination, JBA Policy Manual p.13\"",
    report: `${REPORT} (every Standards of Conduct line the topic table lists)`,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      const said = "ca for Test Employee, she refused to do what I asked";
      t.loopModel!(card(said, "She refused to do what the manager asked.", false));
      const thread = t.thread();
      await thread.say(said);
      expect(policyOf(thread)).toBe("Standards of Conduct — Insubordination, JBA Policy Manual p.13");
    },
  },
  {
    id: "nov24-loop-conduct-no-listed-line-keeps-heading-page",
    title: "Negative: a Standards of Conduct card for an incident with no listed line (\"she hung up on the district office\") keeps the heading's own citation",
    report: `${REPORT} (the condition: only a listed line changes the card)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      const said = "ca for Test Employee, she hung up on the district office";
      t.loopModel!(card(said, "She hung up on the district office.", false));
      const thread = t.thread();
      await thread.say(said);
      expect(policyOf(thread)).toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.\d+$/);
      expect(policyOf(thread)).not.toMatch(/ — /);
    },
  },
];
