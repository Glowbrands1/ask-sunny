import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A GLOBAL LOGIN'S TEAM CARD NEVER NARROWS THE SALONS FROM AN ABBREVIATION EITHER (port of Ask Bubbles #1033, A8)
 * ============================================================================
 *
 * Found in Ask Bubbles (its QA's live re-run 2, 22 Nov 2026, a global login, the loop on), the same loop in Sunny. T1 is
 * the manager's turn verbatim: "can you create a coaching form for my whole staff?". T2 named the sibling company's own
 * program by its abbreviation; here it is said with a Sunny program abbreviation, as in
 * nov22-agent-loop-team-salon-never-guessed-cases.ts (no names, no sibling wording). T2's live reply named two of one
 * city's locations and asked "Which one is this coaching for?"; T3 "this is perfect" called no tool and repeated it
 * ("Glad it looks right! I still just need to know which <city> location this is for — <A> or <B> — before you can
 * press Create."). Here those replies name Sunny's Lincoln salons.
 *
 * Root cause: the check (`salon-guess.ts`, port of #1010) ran only on a team card waiting for its salon
 * (needs_location). A global login's team card with no salon is ready, so the check never ran; on a turn with no tool
 * call it read the card record's `teamNeedsLocation`, false for that card. Now it runs on any team card that holds no
 * salon, and the card record says so (`teamNoSalon`). QA's ruling: any team card with no salon carries salon_question
 * and salon_note, from all the manager's salons. The many-salon director's control is nov22-a8-team-salon-not-guessed-from-abbreviation.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles' QA live re-run 2 (22 Nov 2026, A8): a global login's T2 still got \"You have two <city> locations — … Which one is this coaching for?\", repeated on T3 \"this is perfect\" with no tool call";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const T1 = "can you create a coaching form for my whole staff?";
const T2 = "coaching is on bed room operations for clean organization and flow. Corporate has flagged our BRC due to cleaning logs being signed within 0 minutes of the bed being used. So we are implementing a new flow. when a bed is cleaned, the log is signed at the bed, then the room is checked before the next guest.";
const LIVE_T1 = "You have several salons, so I need to know which one this coaching is for. Which salon should it cover?";
const LIVE_T2 =
  "You have two Lincoln salons — NE Lincoln 27th Street and NE Lincoln O Street. Which one is this coaching for?\n\nThe team card now includes the new bed cleaning flow details (the log signed at the bed, the room checked before the next guest). Once you confirm the salon, it's ready for Create.";
const T3 = "this is perfect";
const LIVE_T3 = "Glad it looks right! I still just need to know which Lincoln salon this is for — 27th Street or O Street — before you can press Create.";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const checkedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /named no such/.test(turn.text));

/** The live model: coach_team on T1 and T2; T2 narrows to two Lincoln salons; T3 calls no tool (`fixes`: not after the hand-back). */
const live = (fixes: boolean) =>
  loopStandIn((view): LoopDecision => {
    const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
    /* T3 "this is perfect": no tool call this turn (the live trace). */
    if (said === T3) return { text: checkedBack(view) && fixes ? "Glad it looks right! Which salon is this for?" : LIVE_T3 };
    if (!lastResult(view, "coach_team")) return { tool: "coach_team", input: {} };
    if (said.startsWith(T1)) return { text: LIVE_T1 };
    return { text: checkedBack(view) && fixes ? "The team card now includes the new bed cleaning flow details. Which salon is this for?" : LIVE_T2 };
  });

const scoped = (role: "salon_director" | "admin", fixes: boolean) => async (t: ReplayContext) => {
  t.as(role, GLOBAL);
  const model = live(fixes);
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say(T1);
  expect((thread.proposal as { subject?: string } | null)?.subject, "T1 made no team card (the case proves nothing)").toBe("team");
  expect(thread.proposal?.locationId ?? null, "the team card already holds a salon (the case proves nothing)").toBeNull();
  /* QA's ruling: a team card with no salon, any scope, carries the plain salon question for the reply to end with. */
  const first = model.views.map((view) => lastResult(view, "coach_team") as { card?: { salon_question?: string } } | null).find(Boolean);
  expect(first?.card?.salon_question, "the global team card with no salon carries no salon question").toBe("Which salon is this for?");
  const reply = await thread.say(T2);
  expect(model.views.some(checkedBack), "the guessed salons were never handed back").toBe(true);
  expect(reply.content, `the reply narrowed the salons from "BRC":\n${reply.content}`).not.toMatch(/Lincoln|27th|O Street/);
  expect(reply.content).toMatch(/bed cleaning flow details/);
  const views = model.views.length;
  const third = await thread.say(T3);
  expect(model.views.slice(views).some(checkedBack), "T3's narrowed question (no tool call) was never handed back").toBe(true);
  expect(third.content, `T3 narrowed the salons again:\n${third.content}`).not.toMatch(/Lincoln|27th|O Street/);
};

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
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_TEAM_SALON_GUESS_GLOBAL_CASES: ReplayCase[] = [
  loopCase(
    "nov22-a8-global-team-salon-not-guessed-from-abbreviation",
    "A8 (Bubbles live re-run 2): a global director's T2 \"coaching is on bed room operations …\" — \"You have two Lincoln salons — …\" goes back once, and neither T2's reply nor T3's (no tool call) names a salon",
    scoped("salon_director", true),
  ),
  loopCase(
    "nov22-a8-admin-team-salon-guess-repeated-left-out",
    "A8 (Bubbles live re-run 2): an admin's T2, the model repeating \"You have two Lincoln salons — …\" after the hand-back — the guessed sentence and its question are left out, and the salon question asked plainly",
    scoped("admin", false),
  ),
];
