import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE TEAM CARD'S SALON COMES ONLY FROM A PLACE THE MANAGER NAMED (QA's re-run, 22 Nov 2026, A8; port of Ask Bubbles #1010)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same loop in Sunny. T1 is the manager's turn verbatim: "can you create a coaching form for
 * my whole staff?". T2 there named the sibling company's own program by its abbreviation; here it is said with a Sunny
 * program abbreviation (no names, no sibling wording), as the mechanism is the same: no turn names a place. The reply
 * after T2 narrowed the location question to one city's locations ("which <city> location is this for, <A> or <B>?").
 * Now the team card's result carries salon_question (all salons, no guess) and a reply naming a salon nobody named goes
 * back once, then asks the salon question plainly (`agent-loop/salon-guess.ts`, read with the app's own salon reader).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's re-run (22 Nov 2026, A8; found in Ask Bubbles): a program's abbreviation narrowed the team card's location question to one city's locations";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const T1 = "can you create a coaching form for my whole staff?";
const T2 = "coaching is on bed room operations for clean organization and flow. Corporate has flagged our BRC due to cleaning logs being signed within 0 minutes of the bed being used. So we are implementing a new flow. when a bed is cleaned, the log is signed at the bed, then the room is checked before the next guest.";
const LIVE = "Updated the team card with the new BRC cleaning flow details. Still need the salon — which Lincoln location is this for, 27th Street or O Street?";
/** A director over Kearney and the three Lincoln salons. */
const MANY_SALONS = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: ["loc-0310", "loc-0311", "loc-0312"] };

const checkedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /named no such/.test(turn.text));

/** The live model: coach_team each turn; after T2 it narrows the salons by "BRC" until handed back (`fixes`). */
const live = (fixes: boolean) =>
  loopStandIn((view): LoopDecision => {
    const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
    const result = lastResult(view, "coach_team") as { card?: { salon_question?: string } } | null;
    if (!result) return { tool: "coach_team", input: {} };
    if (said.startsWith(T1)) return { text: `Here's the team Coaching card for all team members. ${result.card?.salon_question ?? ""}`.trim() };
    return { text: checkedBack(view) && fixes ? `Updated the team card with the new bed cleaning flow. ${result.card?.salon_question ?? "Which salon is this for?"}` : LIVE };
  });

async function chat(t: ReplayContext, fixes: boolean) {
  t.loopModel!(live(fixes));
  const thread = t.thread();
  await thread.say(T1);
  expect((thread.proposal as { subject?: string } | null)?.subject, "T1 made no team card (the case proves nothing)").toBe("team");
  expect((thread.proposal as { status?: string } | null)?.status, "the team card already has a salon (the case proves nothing)").toBe("needs_location");
  return thread.say(T2);
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-21T18:50:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", MANY_SALONS);
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_TEAM_SALON_NEVER_GUESSED_CASES: ReplayCase[] = [
  loopCase("nov22-a8-team-salon-not-guessed-from-abbreviation", "A8: T2 \"coaching is on bed room operations … Corporate has flagged our BRC …\" on the team card: the reply never narrows the salon question to Lincoln; it asks which salon", async (t) => {
    const reply = await chat(t, true);
    expect(reply.content, `the reply guessed a salon from "BRC":\n${reply.content}`).not.toMatch(/Lincoln|27th|O Street/i);
    expect(reply.content).toMatch(/Which salon is this for\?/);
  }),
  loopCase("nov22-a8-team-salon-guess-repeated-replaced", "A8: the model names the Lincoln salons again after the hand-back: that sentence is left out and the reply asks which salon", async (t) => {
    const reply = await chat(t, false);
    expect(reply.content, `the reply guessed a salon from "BRC":\n${reply.content}`).not.toMatch(/Lincoln|27th|O Street/i);
    expect(reply.content).toMatch(/Which salon is this for\?/);
  }),
];
