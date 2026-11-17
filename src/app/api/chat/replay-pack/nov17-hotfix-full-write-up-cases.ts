import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A FORM CREATED FROM A LOOP CARD IS THE FULL WRITE-UP, WITH THE CARD'S POLICY (Pau's rulings via QA, 17 Nov 2026)
 * ============================================================================
 *
 * Pau (6:30-6:40 AM PHT) and QA: the drafter never writes a date the manager did not state, and the card's policy is the
 * policy on the saved form (Policy Violated, Direct policy and its page, the Type of Offense box); the drafter only writes
 * the text around it. (The full write-up's Going Forward and the coaching Other topic follow in their own PRs.) Every case
 * runs the real Create path (createInlineForm → POST /api/forms/instances → POST …/draft); the drafting model is a
 * stand-in, so what is asserted is what the app keeps of its output. Names invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's rulings via QA (17 Nov 2026): the full write-up, the card's policy and no invented date on forms made from loop cards";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type Saved = { values: Record<string, string>; checked: Record<string, string[]> };

/** A loop card (CA or Coaching) with this input, then Create; the drafting stand-in writes `drafted`. */
async function created(
  t: ReplayContext,
  said: string,
  card: Record<string, unknown>,
  drafted: Record<string, string>,
  draftedChecked?: Record<string, string[]>,
): Promise<Saved> {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), ...card } }));
  t.draftWrites(drafted, draftedChecked);
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return { values: t.values(id), checked: t.checked(id) };
}

const FULL = (observed: string) => `Observed:\n${observed}\n\nExpectation:\nRemy is expected to follow this every shift.\n\nGoing Forward:\nRemy will follow it on every shift from now on.`;
const DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/;

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

export const NOV17_HOTFIX_FULL_WRITE_UP_CASES: ReplayCase[] = [
  /* ------------------------------------------------------------- the full write-up, also in Other */
  fixed(
    "nov17-full-write-up-other-msb-ca",
    "An Other — Must See Behaviors loop CA, Create: Other is ticked, Policy Violated names it and the Action Plan names it, not \"the applicable company policy\" (Going Forward follows Pau's answer, in its own PR)",
    async (t) => {
      const saved = await created(
        t,
        "ca for Remy Calder, she did not do her must see behaviors with guests on 11/14",
        { template_key: "dpoa", what_happened: "Remy did not do the Must See Behaviors with guests on 11/14.", policy: "Other — Must See Behaviors", incident_date: "2026-11-14" },
        { observation: FULL("Remy did not do the Must See Behaviors with guests on November 14, 2026.") },
      );
      expect(saved.values.observation ?? "").toContain("Observed:");
      expect(saved.values.observation ?? "").toContain("Expectation:");
      expect(saved.checked.offense_type ?? []).toContain("other");
      expect(saved.values.policy_violated ?? "").toContain("Other — Must See Behaviors");
      expect(saved.values.action_plan ?? "").toContain("Must See Behaviors");
      expect(saved.values.action_plan ?? "").not.toContain("applicable company policy");
    },
  ),
  /* ------------------------------------------------------------- no date the manager did not state */
  fixed(
    "nov17-no-invented-date-offense-only",
    "\"ca for Remy Calder for not doing the 10 minute sanitization\" (no date stated), the drafter writes \"On November 16, 2026, …\": no date is in the Observation or the Action Plan",
    async (t) => {
      const saved = await created(
        t,
        "ca for Remy Calder for not doing the 10 minute sanitization",
        { template_key: "dpoa", what_happened: "Remy did not complete the 10-minute sanitization.", policy: "Other — 10-minute sanitization" },
        { observation: FULL("On November 16, 2026, Remy did not complete the 10-minute sanitization.") },
      );
      expect(saved.values.observation ?? "", "a date the manager never stated is in the Observation").not.toMatch(DATE);
      expect(saved.values.observation ?? "").toContain("Remy did not complete the 10-minute sanitization.");
      expect(saved.values.action_plan ?? "").not.toMatch(DATE);
    },
  ),
  fixed(
    "nov17-no-invented-date-stated-date-kept",
    "\"ca for Remy Calder, she was late to work on 11/14\": the stated date stays in the Observation (\"November 14, 2026\")",
    async (t) => {
      const saved = await created(
        t,
        "ca for Remy Calder, she was late to work on 11/14",
        { template_key: "dpoa", what_happened: "Remy was late to work on 11/14.", policy: "Attendance", incident_date: "2026-11-14" },
        { observation: FULL("Remy was late to work on November 14, 2026.") },
      );
      expect(saved.values.observation ?? "").toContain("November 14, 2026");
    },
  ),
  /* ------------------------------------------------------------- the card's policy is the saved form's */
  ...([
    ["attendance", "ca for Remy Calder, she was 20 minutes late to her shift on 11/14", "Remy was 20 minutes late to her shift on 11/14.", "Attendance", /^Attendance Policy, JBA Policy Manual p\.14/, /Attendance, p\. 14/],
    ["late-opening", "ca for Remy Calder, she opened the salon 30 minutes late on 11/14", "Remy opened the salon 30 minutes late on 11/14.", "Late Opening", /Late Opening/, /Late Opening, p\. 15/],
    ["standards-of-conduct", "ca for Remy Calder, a guest complained that she was rude at the front desk on 11/14", "A guest complained that Remy was rude at the front desk on 11/14.", "Standards of Conduct", /Standards of Conduct/, /Standards of Conduct, p\. 12/],
  ] as const).map(([what, said, account, heading, violated, language]) =>
    fixed(
      `nov17-card-policy-is-saved-${what}`,
      `A loop CA card citing ${heading}, while the drafter ticks Dress Code: the saved Policy Violated, Direct policy and Type of Offense are the card's ${heading}`,
      async (t) => {
        const saved = await created(
          t,
          said,
          { template_key: "dpoa", what_happened: account, policy: heading, incident_date: "2026-11-14" },
          { observation: FULL(account) },
          { offense_type: ["dress_code"] },
        );
        expect(saved.values.policy_violated ?? "", "Policy Violated is not the card's").toMatch(violated);
        expect(saved.values.policy_language ?? "", "Direct policy is not the card's section").toMatch(language);
        expect(saved.checked.offense_type ?? [], "the drafter's box replaced the card's").not.toContain("dress_code");
      },
    ),
  ),
];
