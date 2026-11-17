import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED FORM CARRIES THE POLICY THE LOOP CARD CITED (QA hotfix, 17 Nov 2026; live on main 6d0b4ab1)
 * ============================================================================
 *
 * The tester's Create (form 7545d162): a loop Corrective Action card citing "Other — <topic>" saved with no Type of
 * Offense, an empty Policy Violated and Direct policy, and an Action Plan on "the applicable company policy". The draft
 * request carried only the card's heading ("Other" is none), so the drafter was told "APPROVED POLICY: none found". The
 * general rule: the saved form carries what the card promised. "Other — <topic>" ticks the form's Other, Policy Violated
 * reads "Other — <topic>" and the plan names it; "<heading>; Other — <topic>" ticks both and cites the heading's text and
 * page; a real heading (Attendance p.14) reaches Policy Violated and Direct policy. Every case runs the real Create path
 * (createInlineForm → POST /api/forms/instances → POST …/draft). Names invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA hotfix (17 Nov 2026): the tester's form 7545d162, a loop CA citing Other — <topic>, saved with no policy";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** A loop CA card with this policy and account, then Create; the drafting stand-in writes the Observation only. */
async function createdCard(t: ReplayContext, said: string, policy: string, account: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, policy, incident_date: "2026-11-14" } }));
  t.draftWrites({ observation: `Observed:\n${account}\n\nExpectation:\nRemy is expected to follow the procedure.` });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  const prompts = (t as unknown as { draftPrompts?: () => string[] }).draftPrompts?.() ?? [];
  return { values: t.values(id), checked: t.checked(id), prompt: prompts.at(-1) ?? "" };
}

export const NOV17_HOTFIX_LOOP_CARD_POLICY_CASES: ReplayCase[] = [
  ...([
    ["cleaning", "10-minute sanitization", "ca for Remy Calder, she did not do the 10 minute sanitization on 11/14", "Remy did not complete the 10-minute sanitization on 11/14."],
    ["no-section", "tanning room door left open", "ca for Remy Calder, she left the tanning room door open during a session on 11/14", "Remy left the tanning room door open during a session on 11/14."],
  ] as const).map(([what, topic, said, account]): ReplayCase => ({
    id: `nov17-hotfix-loop-card-other-${what}-saved`,
    title: `A loop CA card citing "Other — ${topic}", then Create: the saved form ticks Other, Policy Violated reads "Other — ${topic}", the plan names it, and the drafter is never told "none found"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const saved = await createdCard(t, said, `Other — ${topic}`, account);
      expect(saved.checked.offense_type ?? [], "Type of Offense: Other is not ticked").toContain("other");
      expect(saved.values.policy_violated ?? "", "Policy Violated does not say what the Other is").toContain(`Other — ${topic}`);
      expect(saved.values.action_plan ?? "", "the Action Plan does not name the card's Other").toContain(topic);
      expect(saved.values.action_plan ?? "").not.toContain("applicable company policy");
      expect(saved.prompt, "the drafter was told no policy").not.toContain("none found");
      expect(saved.prompt).toContain(`Other — ${topic}`);
    },
  })),
  {
    id: "nov17-hotfix-loop-card-heading-and-other-saved",
    title: "A loop CA card citing \"Attendance Policy, JBA Policy Manual p.14; Other — 10-minute sanitization\", then Create: both are ticked, Attendance is cited with its text and page, and Policy Violated names the Other",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const saved = await createdCard(t, "ca for Remy Calder, she was late on 11/14 and did not do the 10 minute sanitization", "Attendance; Other — 10-minute sanitization", "Remy was late on 11/14 and did not complete the 10-minute sanitization.");
      expect(saved.checked.offense_type ?? []).toEqual(expect.arrayContaining(["attendance_policy", "other"]));
      expect(saved.values.policy_violated ?? "").toContain("Attendance Policy, JBA Policy Manual p.14");
      expect(saved.values.policy_violated ?? "").toContain("Other — 10-minute sanitization");
      expect(saved.values.policy_language ?? "", "Direct policy does not cite Attendance").toMatch(/Attendance, p\. 14/);
    },
  },
  {
    id: "nov17-hotfix-loop-card-heading-saved",
    title: "Check (QA): a loop CA card citing \"Attendance Policy, JBA Policy Manual p.14\", then Create: Policy Violated and Direct policy carry it; no Other is added",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const saved = await createdCard(t, "ca for Remy Calder, she was 20 minutes late to her shift on 11/14", "Attendance", "Remy was 20 minutes late to her shift on 11/14.");
      expect(saved.checked.offense_type ?? []).toEqual(["attendance_policy"]);
      expect(saved.values.policy_violated ?? "").toBe("Attendance Policy, JBA Policy Manual p.14");
      expect(saved.values.policy_language ?? "").toMatch(/Attendance, p\. 14/);
    },
  },
];
