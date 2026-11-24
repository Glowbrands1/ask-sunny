import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD'S PERSON BY FIRST NAME, NOT THE FULL NAME (QA, 20 Nov 2026; live on main b06e51be, draft 9f0b35c6)
 * ============================================================================
 *
 * QA typed "ca for Test Testy, late 11/18" (a test name off the staff list) and got "Here's the Corrective Action Form for
 * **Test Testy**", "Observation of Offense: Test Testy was late on 11/18", and a saved Observed of "Test Testy was late
 * to work on November 18, 2026." (Expectation and Going Forward said "Test"). The same message an hour earlier said
 * "Test" throughout: the model had written "She", which the pronoun pass names by the reply name. Pau's rule is the
 * first name. Code now puts the reply name in place of the full name on the card's account, in the reply (except the
 * lines that confirm which person it is: the not-on-the-staff-list line keeps "**Test Testy**"), and in the saved
 * write-up. The stand-in model and drafter here write the full name, as the live ones did.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026; main b06e51be, draft 9f0b35c6): \"Here's the Corrective Action Form for **Test Testy**\" and Observed \"Test Testy was late to work\" after Pau's first-name rule";
const SAID = "ca for Test Testy, late 11/18";
const LIVE_REPLY = [
  "Here's the Corrective Action Form for **Test Testy**.",
  "",
  "**Test Testy** isn't on the Woven staff list, so I've used the name as you typed it. Check the spelling before you press Create.",
  "",
  "**Observation of Offense:** Test Testy was late on 11/18.",
  "**Policy:** Attendance Policy, JBA Policy Manual p.14",
].join("\n");

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T22:05:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);

/** The live model: the full name on the card's account and in its reply. */
function fullNameModel(reply: string) {
  return loopStandIn((view): LoopDecision => {
    if (view.results.some((entry) => entry.tool === "propose_form")) return { text: reply };
    const quote = { message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote: "Test Testy" };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Test Testy", person_evidence: quote, what_happened: "Test Testy was late on 11/18.", incident_date: "2026-11-18", policy: "Attendance" } };
  });
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV20_CARD_FULL_NAME_SHORTENED_CASES: ReplayCase[] = [
  fixed("nov20-card-full-name-becomes-first-name-in-reply-and-card", `"${SAID}": the model writes "Test Testy" on the card's account and in its reply; the card and the reply say "Test", and the not-on-the-staff-list line keeps "**Test Testy**"`, async (t) => {
    t.loopModel!(fullNameModel(LIVE_REPLY));
    const reply = await t.thread().say(SAID);
    const card = reply.formProposal as ChatFormProposal | undefined;
    expect(card?.employeeName, "the card's name field keeps the full name").toBe("Test Testy");
    expect(card?.issue, "the card's account named the person in full").toBe("Test was late on 11/18.");
    expect(reply.content, reply.content).toContain("Here's the Corrective Action Form for **Test**.");
    expect(reply.content, reply.content).toContain("**Observation of Offense:** Test was late on 11/18.");
    expect(reply.content, "the line that confirms which person it is lost the full name").toContain("**Test Testy** isn't on the Woven staff list");
  }),
  fixed("nov20-card-full-name-saved-observed-starts-with-first-name", `"${SAID}", then Create, and the drafter writes "Test Testy was late to work on November 18, 2026.": the saved Observed starts "Test was late"`, async (t) => {
    t.loopModel!(fullNameModel(LIVE_REPLY));
    const thread = t.thread();
    await thread.say(SAID);
    t.draftWrites({ observation: "Observed:\nTest Testy was late to work on November 18, 2026.\n\nExpectation:\nTest is expected to arrive on time for every scheduled shift." });
    const id = await thread.create();
    const observation = t.values(id).observation ?? "";
    expect(observation, observation).toMatch(/^Observed:\s*Test was late to work on November 18, 2026\./);
    expect(observation, observation).not.toMatch(/\bTest Testy\b/);
  }),
  fixed("nov20-card-full-name-question-keeps-it", `Control: a reply that asks a question naming "Test Testy" keeps the full name there (the which-person and did-you-mean questions are read back by the app)`, async (t) => {
    t.loopModel!(fullNameModel(`${LIVE_REPLY}\n\nIs this for Test Testy at Kearney?`));
    const reply = await t.thread().say(SAID);
    expect(reply.content, reply.content).toContain("Is this for Test Testy at Kearney?");
    expect(reply.content, reply.content).toContain("**Observation of Offense:** Test was late on 11/18.");
  }),
];
