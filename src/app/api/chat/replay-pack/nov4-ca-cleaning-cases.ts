import { expect, vi } from "vitest";

import { caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A CLEANING CORRECTIVE ACTION DOES NOT CITE THE STANDARDS OF CONDUCT BY
 * DEFAULT (Pau, 4 Nov 2026, 16:50 UTC; CA_SALES_POLICY_ENABLED)
 * ============================================================================
 *
 * QA's live run (Haiku), flag on and off: "the tanning beds were left dirty at
 * close" came back with Standards of Conduct ticked and cited on p.12. The
 * stand-in model here ticks it the same way. With the flag on, a Standards of
 * Conduct tick with no reason in the manager's words and the model's own
 * basis "upkeep_or_task" moves to Other, with their words beside it
 * (`ca-conduct-reason.ts`); a named policy, the MSB reading, wrong items and
 * attendance keep their box. Every person is invented.
 */

type T = ReplayContext;

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const HALLORAN = person("e-halloran-sweetbriar", "Halloran", "Sweetbriar");
const MIREILLE = person("e-mireille-duskwater", "Mireille", "Duskwater");
const PEOPLE: readonly DirectoryRow[] = [HALLORAN, MIREILLE];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function caCleaningPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const REPORT = "QA live run with Haiku, 4 Nov 2026; Pau's decision (16:50 UTC): a cleaning CA does not cite the Standards of Conduct by default";
const FLAG = "CA_SALES_POLICY_ENABLED";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The model ticks the Standards of Conduct, as Haiku did live, and says what the account is about (`offense_basis`; none: as before the field). */
async function draftTickingConduct(t: T, thread: ReturnType<T["thread"]>, observation: string, basis?: string) {
  t.draftWrites({ observation: `Observed:\n${observation}` }, { offense_type: ["standards_of_conduct"] }, basis ? { offense_basis: basis } : undefined);
  const id = await thread.create();
  return { values: t.values(id), checked: t.checked(id) };
}

function citesNoConduct(saved: { values: Record<string, string>; checked: Record<string, string[]> }): void {
  expect(saved.checked.offense_type ?? [], "Standards of Conduct is still ticked").not.toContain("standards_of_conduct");
  expect(saved.checked.offense_type ?? [], "Other is not ticked").toContain("other");
  expect(saved.values.policy_violated ?? "", "Policy Violated cites the Standards of Conduct").not.toMatch(/standards of conduct/i);
  expect(saved.values.policy_language ?? "", "Direct policy cites the Standards of Conduct").not.toMatch(/standards of conduct/i);
}

export const NOV4_CA_CLEANING_CASES: ReplayCase[] = [
  {
    id: "nov4-cleaning-tanning-beds-not-conduct",
    title: "\"the tanning beds were left dirty at close\": the model's Standards of Conduct tick moves to Other, no Standards of Conduct citation",
    report: `${REPORT}: QA's live wording`,
    status: { open: "with production's flags the model's Standards of Conduct tick stands and is cited (p.12)" },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Halloran Sweetbriar, the tanning beds were left dirty at close");
      expect(thread.proposal, "no CA card").toMatchObject({ templateKey: "dpoa", employeeName: "Halloran Sweetbriar" });
      const saved = await draftTickingConduct(t, thread, "The tanning beds were left dirty at close.", "upkeep_or_task");
      citesNoConduct(saved);
      expect(saved.values.policy_violated ?? "", "Policy Violated is not the manager's account").toMatch(/tanning beds were left dirty at close/i);
    },
  },
  {
    id: "nov4-cleaning-negative-no-basis",
    title: "negative control: with no offense_basis from the model, its Standards of Conduct tick stands (as before the flag; Woven training past due reads the same as a task)",
    report: `${REPORT}: no basis, the model's tick stands`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Halloran Sweetbriar, he did not complete daily cleaning duties");
      const saved = await draftTickingConduct(t, thread, "Halloran Sweetbriar did not complete the daily cleaning duties.");
      expect(saved.checked.offense_type ?? [], "the model's Standards of Conduct was unticked with no basis").toContain("standards_of_conduct");
    },
  },
  {
    id: "nov4-cleaning-negative-named-conduct",
    title: "negative control: the manager names the Standards of Conduct, so it stays ticked and cited",
    report: `${REPORT}: negative control`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Mireille Duskwater for violating the standards of conduct policy, the tanning beds were left dirty at close");
      const saved = await draftTickingConduct(t, thread, "The tanning beds were left dirty at close.");
      expect(saved.checked.offense_type ?? [], "the named Standards of Conduct was unticked").toContain("standards_of_conduct");
      expect(saved.values.policy_violated ?? "", "Policy Violated").toMatch(/standards of conduct/i);
    },
  },
  {
    id: "nov4-cleaning-negative-msb",
    title: "negative control: an MSB CA keeps the Standards of Conduct",
    report: `${REPORT}: negative control`,
    // Holds with production's flags too: this app makes the MSB card there (revision 8).
    status: "fixed",
    fixFlags: [FLAG, "CHAT_GLOSSARY_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("MSB CA for Mireille Duskwater for underperformance in the month of October");
      const saved = await draftTickingConduct(t, thread, "Mireille Duskwater did not perform the Must See Behaviors in October.", "msb");
      expect(saved.checked.offense_type ?? [], "the MSB Standards of Conduct was unticked").toContain("standards_of_conduct");
      expect(saved.values.policy_violated ?? "", "Policy Violated").toMatch(/standards of conduct/i);
    },
  },
  {
    id: "nov4-cleaning-negative-attendance",
    title: "negative control: a late arrival keeps the Attendance Policy",
    report: `${REPORT}: negative control`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Mireille Duskwater, she was 40 minutes late for her shift on 11/2");
      t.draftWrites({ observation: "Observed:\nMireille Duskwater arrived 40 minutes late for her shift on November 2." }, { offense_type: ["attendance_policy"] });
      const id = await thread.create();
      expect(t.checked(id).offense_type ?? [], "Attendance Policy is not ticked").toContain("attendance_policy");
      expect(t.checked(id).offense_type ?? [], "Other was ticked").not.toContain("other");
      expect(t.values(id).policy_violated ?? "", "Policy Violated").toMatch(/^Attendance Policy/);
    },
  },
  {
    id: "nov4-cleaning-wrong-items-keeps-conduct",
    title: "\"rang up the wrong items\": the model's sales basis keeps the Standards of Conduct (Pau, 4 Nov 2026)",
    report: `${REPORT}: wrong items keeps the Standards of Conduct`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("create a corrective action for Halloran Sweetbriar for ringing up the wrong items on a guest's order");
      const saved = await draftTickingConduct(t, thread, "Halloran Sweetbriar rang up the wrong items on a guest's order.", "sales");
      expect(saved.checked.offense_type ?? [], "the Standards of Conduct was unticked").toContain("standards_of_conduct");
      expect(saved.values.policy_violated ?? "", "Policy Violated").toMatch(/standards of conduct/i);
    },
  },
  {
    id: "nov4-cleaning-basis-upkeep-duties",
    title: "\"did not complete daily cleaning duties\" with the model's upkeep basis: Other",
    report: `${REPORT}: Pau's wording, with offense_basis`,
    status: { open: "with production's flags the task reading ticks and cites the Standards of Conduct" },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Halloran Sweetbriar, he did not complete daily cleaning duties");
      citesNoConduct(await draftTickingConduct(t, thread, "Halloran Sweetbriar did not complete the daily cleaning duties.", "upkeep_or_task"));
    },
  },
  {
    id: "nov4-cleaning-offense-basis-only-with-flag",
    title: "the draft tool carries the optional offense_basis only with CA_SALES_POLICY_ENABLED on; off, the tool is as before",
    report: `${REPORT}: QA's condition, flag off byte-identical`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("make a corrective action for Halloran Sweetbriar, the tanning beds were left dirty at close");
      await draftTickingConduct(t, thread, "The tanning beds were left dirty at close.");
      const tools = t.draftTools();
      expect(tools.length, "no draft call").toBeGreaterThan(0);
      for (const sent of tools) {
        if (caSalesPolicyEnabled()) expect(sent, "the tool has no offense_basis").toContain("\"offense_basis\"");
        else expect(sent, "the tool carries offense_basis with the flag off").not.toContain("offense_basis");
      }
    },
  },
];
