import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * CREATE FROM A LOOP CARD DRAFTS THE CARD'S ACCOUNT, UNDER THE CARD'S POLICY BOX (QA, 18 Nov 2026; live)
 * ============================================================================
 *
 * Pau's own test chat (the employee is real; names invented here, the manager is the pack's signed-in "QA Manager"):
 *   T1 "Ca for <the manager herself> she weas wearing mini skirt on 9/12" — Sunny asked who the form is about.
 *   T2 "for <employee>" — a CA card with Observation "<first> was wearing a mini skirt on 9/12." and Policy "All Locations
 *      Dress Code Policy, JBA Policy Manual p.15"; Create.
 *   T3 "payroll deduct 20$".
 * Bug 1: the saved Observation was EMPTY ("The details are blank: you haven't told me what happened yet…"). The card's
 * request was only T2, so the draft notes were "for <employee>". A loop card that carries an account drafts from it.
 * Bug 2: Type of Offense "Standards of Conduct" and Policy Violated "Standards of Conduct — All Locations Dress Code". The
 * box follows the card's heading (Dress Code Violation), and Policy Violated is the card's heading with its page.
 * Every case runs the real Create path; the drafting model is a stand-in that ticks Standards of Conduct as the live one did.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (18 Nov 2026), live conv in Pau's test: Create from a loop card saved an empty Observation and the wrong offense box";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

/** The production manual's dress code heading (the pack's manual has none). */
const DRESS_CODE = {
  chunkIndex: 34.5,
  chunkId: "jba-34-5",
  locator: "Page 15 — All Locations Dress Code",
  page: 16,
  printedPage: 15,
  section: "All Locations Dress Code",
  sections: [{ heading: "All Locations Dress Code", page: 15 }],
  content: "All Locations Dress Code:\nEmployees wear approved work attire. No mini skirts or short shorts.",
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([DRESS_CODE]);
}

type Edit = { saved?: { field: string }[] };

/** T1 names the manager (refused), T2 names the employee (the card), T3 (optional) the payroll edit on the saved draft. */
function liveModel(instanceId: () => string | null) {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form");
    if (users(view) === 1) {
      return result ? { text: "Who is this Corrective Action Form about?" } : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "QA Manager", person_evidence: evidenceFrom(view, "qa") } };
    }
    if (users(view) === 2) {
      return result
        ? { text: "Here's the Corrective Action Form for **Remy**." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "remy"), what_happened: "Remy was wearing a mini skirt on 9/12.", policy: "All Locations Dress Code", incident_date: "2026-09-12" } };
    }
    if (lastResult(view, "edit_form")) return { text: "Done." };
    return { tool: "edit_form", input: { instance_id: instanceId(), payroll_evidence: evidenceFrom(view), values: { payroll_deduct: "yes", payroll_deduct_amount: "$20" } } };
  });
}

const DRAFTED = "Observed:\nRemy was wearing a mini skirt on September 12, 2026.\n\nExpectation:\nRemy is expected to follow the dress code.\n\nGoing Forward:\nRemy will follow the dress code on every shift.";

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

export const NOV18_LIVE_CREATE_LOOP_ACCOUNT_CASES: ReplayCase[] = [
  fixed("nov18-live-create-loop-card-account-is-drafted", "\"Ca for qa she weas wearing mini skirt on 9/12\" (the manager), \"for remy\", Create: the drafter is given the card's account and the saved Observation is written", async (t) => {
    let id: string | null = null;
    t.loopModel!(liveModel(() => id));
    t.draftWrites({ observation: DRAFTED }, { offense_type: ["standards_of_conduct"] });
    const thread = t.thread();
    await thread.say("Ca for qa she weas wearing mini skirt on 9/12");
    await thread.say("for remy");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    id = await thread.create();
    const prompt = ((t as unknown as { draftPrompts?: () => string[] }).draftPrompts?.() ?? []).at(-1) ?? "";
    expect(prompt, "the drafter was not given the card's account").toContain("Remy was wearing a mini skirt on 9/12.");
    expect(t.values(id).observation ?? "", "the saved Observation is empty").toContain("mini skirt");
  }),
  fixed("nov18-live-create-loop-card-policy-box", "The same card (All Locations Dress Code Policy, JBA Policy Manual p.15), the drafter ticking Standards of Conduct: Type of Offense is Dress Code Violation and Policy Violated is the card's heading with its page", async (t) => {
    let id: string | null = null;
    t.loopModel!(liveModel(() => id));
    t.draftWrites({ observation: DRAFTED }, { offense_type: ["standards_of_conduct"] });
    const thread = t.thread();
    await thread.say("Ca for qa she weas wearing mini skirt on 9/12");
    await thread.say("for remy");
    id = await thread.create();
    expect(t.checked(id).offense_type ?? []).toEqual(["dress_code"]);
    expect(t.values(id).policy_violated ?? "").toBe("All Locations Dress Code Policy, JBA Policy Manual p.15");
  }),
  fixed("nov18-live-create-then-payroll-reaches-the-form", "T3 \"payroll deduct 20$\" after Create: the saved draft says Yes and $20", async (t) => {
    let id: string | null = null;
    const model = liveModel(() => id);
    t.loopModel!(model);
    t.draftWrites({ observation: DRAFTED }, { offense_type: ["standards_of_conduct"] });
    const thread = t.thread();
    await thread.say("Ca for qa she weas wearing mini skirt on 9/12");
    await thread.say("for remy");
    id = await thread.create();
    await thread.say("payroll deduct 20$");
    const edit = model.views.flatMap((view) => view.results).filter((result) => result.tool === "edit_form").at(-1)?.output as Edit | undefined;
    expect(edit?.saved?.map((row) => row.field) ?? [], JSON.stringify(edit)).toEqual(expect.arrayContaining(["payroll_deduct", "payroll_deduct_amount"]));
    expect(t.values(id).payroll_deduct_amount ?? "").toMatch(/^\$?20(?:\.00)?$/);
  }),
  fixed("nov18-live-create-loop-card-no-account-control", "Control: a loop Coaching card with no account (\"coaching for remy calder\"), Create: no account is made up — the drafter is given only the manager's turns, and the Details stay blank", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
      ? { text: "Here's the Coaching Form for **Remy**. What happened?" }
      : { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "remy calder") } }));
    t.draftWrites({});
    const thread = t.thread();
    await thread.say("coaching for remy calder");
    const id = await thread.create();
    const prompt = ((t as unknown as { draftPrompts?: () => string[] }).draftPrompts?.() ?? []).at(-1) ?? "";
    expect(prompt, "a card with no account drafted from card lines").not.toContain("What happened:");
    expect(t.values(id).coaching_details ?? "").toBe("");
  }),
];
