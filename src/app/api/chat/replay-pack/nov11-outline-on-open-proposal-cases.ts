import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN OUTLINE PASTED ON AN OPEN PROPOSAL NEVER COSTS THE PROPOSAL ITS FACTS (QA's Bubbles 17i live test, 11 Nov 2026)
 * ============================================================================
 *
 * Admin, Create never pressed: (a) "create a corrective action for <A>, she was late on 11/3/26" → the card (Issue,
 * Attendance p.14); (b) an Observation / Action Plan outline written for another person → ignored; (c) "same outline but
 * with <A first>'s info" → no Issue, no Policy, a generic plan (live). In the pack, (c)'s Issue takes the outline's date.
 * OUTLINE_ON_OPEN_PROPOSAL_ENABLED. The tester's turns; the people are invented (B is on no roster).
 */
const FLAG = "OUTLINE_ON_OPEN_PROPOSAL_ENABLED";
const ILSA: DirectoryRow = { id: "e-oop-ilsa-varnholt", firstName: "Ilsa", lastName: "Varnholt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const A = "create a corrective action for Ilsa Varnholt, she was late on 11/3/26";
const OUTLINE =
  "Observation of Offense: Corisande Velt arrived 20 minutes late to her opening shift on 10/12/26 and did not call the manager on duty.\nAction Plan: The Leadership Team will coach Corisande on the Attendance policy and review call-in expectations. Further late arrivals may result in additional corrective action up to and including termination.";
const C = "same outline but with Ilsa's info";

function start(t: ReplayContext) {
  t.directory([...STAFF, ILSA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** This app's card has no Issue line: steps (b) and (c) keep step (a)'s card, and never the outline's person or date. */
function keepsStepA(reply: { content: string }, card: Record<string, unknown> | null, step: string, first: Record<string, unknown> | null) {
  expect(card, `${step}: no card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Ilsa Varnholt" });
  for (const key of ["issue", "formDate", "warningLevel"]) expect(card?.[key] ?? null, `${step}: ${key} changed:\n${reply.content}`).toEqual(first?.[key] ?? null);
  expect(reply.content, `${step}: the outline's person or date is on the card:\n${reply.content}`).not.toMatch(/Corisande|10\/12\/26/);
  expect(reply.content, `${step}: the Attendance policy is lost:\n${reply.content}`).toMatch(/\*\*Policy:\*\*[^\n]*Attendance/);
}

export const NOV11_OUTLINE_ON_OPEN_PROPOSAL_CASES: ReplayCase[] = [
  {
    id: "nov11-17i-outline-on-open-proposal",
    title: "a proposal, an outline for another person pasted, then \"same outline but with Ilsa's info\": step (a)'s Issue, date and Attendance policy are kept",
    report: "QA's Bubbles 17i live test via the sibling app, 11 Nov 2026 (admin; Create never pressed); reproduced here",
    status: { open: "the pasted outline is re-read as her account: the card's date becomes the outline's" },
    fixFlags: [FLAG],

    async run(t) {
      const thread = start(t);
      const a = await thread.say(A);
      const first = thread.proposal as Record<string, unknown> | null;
      keepsStepA(a, first, "a", first);
      const b = await thread.say(OUTLINE);
      keepsStepA(b, thread.proposal as Record<string, unknown> | null, "b", first);
      const c = await thread.say(C);
      keepsStepA(c, thread.proposal as Record<string, unknown> | null, "c", first);
      // QA (11 Nov 2026): Create after the three turns — the outline's person, date and events never reach the draft.
      t.draftWrites({ observation: "Observed:\nIlsa Varnholt was late on 11/3/26." });
      const id = await thread.create();
      const described = t.draftPrompts().map((prompt) => prompt.split("WHAT THE MANAGER DESCRIBED:")[1] ?? "").join("\n");
      expect(described, `the outline reached the drafting model:\n${described}`).not.toMatch(/Corisande|10\/12\/26|did not call the manager/i);
      expect(described, `step (a)'s account did not reach the drafting model:\n${described}`).toMatch(/late on 11\/3\/26/);
      const saved = Object.values(t.values(id)).join("\n");
      expect(saved, `the outline's person or date is on the draft:\n${saved}`).not.toMatch(/Corisande|10\/12\/26/);
    },
  },
];

/*
 * Gate-Bubbles-4's NO-GO on the sibling app's B#802 (G4-802, 12 Nov 2026), ported: the manager's own account, labelled or asking for "this format",
 * was read as an outline and lost. Guards: production keeps it, and so does the flag (an outline names another person).
 */
const OWN_ACCOUNT = [
  ["labelled-account", "create a corrective action for Ilsa Varnholt", "Date: 11/3/26\nWhat happened: Ilsa Varnholt arrived 40 minutes late and did not call in.", /40 minutes late/],
  ["this-format", "create a corrective action for Ilsa Varnholt", "Ilsa Varnholt was late on 11/3/26. Use this format for the action plan.", /late on 11\/3\/26/],
  // Gate-Sunny-3's NO-GO on S#875 (12 Nov 2026): her account names a coworker who covered (the gate's probe).
  ["coworker-named", "create a corrective action for Ilsa Varnholt", "Date: 11/3/26\nWhat happened: Ilsa was 40 minutes late to her opening shift. Jordan had to cover the front desk until she arrived", /40 minutes late/],
] as const;

export const NOV12_OUTLINE_OWN_ACCOUNT_CASES: ReplayCase[] = OWN_ACCOUNT.map(([key, request, account, kept]) => ({
  id: `nov12-g4-802-own-account-kept-${key}`,
  title: `"${request}", then "${account.replace(/\n/g, " / ")}": her own account reaches the card and the draft`,
  report: "Gate-Bubbles-4's NO-GO on OUTLINE_ON_OPEN_PROPOSAL (G4-802, 12 Nov 2026)",
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    const thread = start(t);
    await thread.say(request);
    const reply = await thread.say(account);
    expect(thread.proposal, `no card for Ilsa Varnholt:\n${reply.content}`).toMatchObject({ employeeName: "Ilsa Varnholt" });
    expect(reply.content, `her account was read as an outline:\n${reply.content}`).not.toMatch(/pasted example/);
    t.draftWrites({ observation: "Observed:\nIlsa Varnholt was late." });
    await thread.create();
    const described = t.draftPrompts().map((prompt) => prompt.split("WHAT THE MANAGER DESCRIBED:")[1] ?? "").join("\n");
    expect(described, `her account did not reach the drafting model:\n${described}`).toMatch(kept);
  },
}));
