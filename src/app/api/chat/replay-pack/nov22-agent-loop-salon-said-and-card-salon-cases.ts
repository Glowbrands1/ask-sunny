import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD'S SALON AS THE MANAGER SAID IT; THE CARD RECORD KEEPS ITS SALON ID (port of Ask Bubbles #1048: its QA's live
 * round 3, 22 Nov 2026, A7 and A1(a))
 * ============================================================================
 *
 * Found in Ask Bubbles, the same loop in Sunny (salon for store; the people are invented):
 *
 * A7: T1 "do verbal for team member <P> at <the salon by another name> …" was filed at that salon, but the reply said
 * "The card is filed at <salon>, where Woven lists <P>'s salon (<the manager's words> isn't one I recognize …)": nothing
 * told the model the manager's words were the card's salon. Now propose_form's result names them (salon_said), read by the
 * app's salon reader, and the rules book's own "where Woven lists" line with no salon_from_woven goes back once, then is
 * left out.
 *
 * A1(a): T4 "she is at <city> <street>" made no card, and the reply's true "filed at <salon>" was a mismatch because the
 * card record held no salon for a person's card. The card record now holds the card's salon id (never a name).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles' live round 3 (22 Nov 2026, A7 and A1(a)): the reply said the card was placed by Woven and that the manager's words for the salon weren't one it recognised; a true \"filed at <salon>\" on a turn with no card was replaced";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** Woven lists this person at Grand Island only; the manager names Kearney. */
const THESSALY: DirectoryRow = { id: "e-thessaly-wrenbrook", firstName: "Thessaly", lastName: "Wrenbrook", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307"], positionName: "Tanning Consultant" };
const A7_T1 = "do verbal for team member thessaly wrenbrook at kearney. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 thessaly was not scheduled to work and came into the salon to show her team her new puppy. Thessaly was in the salon 45 min";
const LIVE_A7 = "The card is filed at **NE Kearney**, where Woven lists Thessaly's salon (Kearney isn't one I recognize as a salon name) — say if it should be elsewhere.";
const A7_ACCOUNT = "On 10/22/26 Thessaly was not scheduled to work and came into the salon to show the team the new puppy.";

const A1 = {
  T1: "My employee ottoline vashgrove has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
  T2: "I already told you the employee name. She is at O Street",
  T3: "Create the coaching form with the information given. Her name is ottoline vashgrov and she is at O Street. She is a tanning consultant",
  T4: "she is at lincoln o street",
};
const A1_ACCOUNT = "Ottoline was 10 minutes late on the last two shifts, on 10/5 and 10/15. After the first late shift Ottoline was verbally coached on policy and expectations, then Ottoline was late again.";
const LIVE_A1_T4 = "Here's the Coaching Form for **Ottoline Vashgrov**, filed at **NE Lincoln O Street**.";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_SALON_SAID_AND_CARD_SALON_CASES: ReplayCase[] = [
  loopCase("nov22-r3-a7-salon-said-never-unrecognised", "Round 3 A7: \"… at kearney …\" for a person Woven lists at Grand Island — filed at Kearney, propose_form says the manager's \"kearney\" is that salon (salon_said), and the reply never calls it unrecognised or Woven-placed", async (t) => {
    vi.setSystemTime(new Date("2026-11-22T15:33:00Z"));
    t.directory([...STAFF, THESSALY]);
    t.as("salon_director", TWO_SALONS);
    const model = loopStandIn((view): LoopDecision => {
      const result = lastResult(view, "propose_form") as { facts?: { salon_said?: { said?: string; salon?: string } } } | null;
      if (result) return { text: result.facts?.salon_said ? `Here's the Corrective Action Form for **Thessaly**, filed at **${result.facts.salon_said.salon}**.` : `Here's the Corrective Action Form for **Thessaly**.\n\n${LIVE_A7}` };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: THESSALY.id, what_happened: A7_ACCOUNT, warning_level: "verbal", level_evidence: evidenceFrom(view, "do verbal"), policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "thessaly wrenbrook") } };
    });
    t.loopModel!(model);
    const thread = t.thread();
    const reply = await thread.say(A7_T1);
    expect(thread.proposal?.locationId, "the case proves nothing: the card is not at Kearney").toBe("loc-0309");
    const facts = model.views.map((view) => lastResult(view, "propose_form") as { facts?: { salon_said?: { said?: string } } } | null).filter(Boolean).at(-1)?.facts;
    expect(facts?.salon_said?.said ?? "", "the model is not told the manager's words are the card's salon").toMatch(/kearney/i);
    expect(reply.content, `the reply calls the salon unrecognised or Woven-placed:\n${reply.content}`).not.toMatch(/isn't one I recognize|where Woven lists/i);
  }),
  loopCase("nov22-r3-a1a-no-card-turn-keeps-true-salon-claim", "Round 3 A1(a): T4 \"she is at lincoln o street\" with no card this turn and the reply \"… filed at NE Lincoln O Street\" (true: the card shown is filed there) — never handed back or replaced", async (t) => {
    vi.setSystemTime(new Date("2026-11-22T15:29:00Z"));
    t.directory([...STAFF]);
    t.as("admin", ADMIN);
    const model = loopStandIn((view): LoopDecision => {
      const message = said(view);
      if (message === A1.T4) return { text: LIVE_A1_T4 };
      if (lastResult(view, "propose_form")) return { text: "Here's the card." };
      const coaching = message === A1.T3;
      return {
        tool: "propose_form",
        input: {
          template_key: coaching ? "coaching" : "dpoa",
          employee_name: coaching ? "Ottoline Vashgrov" : "Ottoline Vashgrove",
          what_happened: A1_ACCOUNT,
          ...(message === A1.T1 ? {} : { salon: "O Street" }),
          policy: headingWith(view, /attendance/i),
          person_evidence: evidenceFrom(view, coaching ? "ottoline vashgrov" : "ottoline vashgrove", coaching ? back(view, A1.T3) : back(view, A1.T1)),
          ...(coaching ? { form_change_evidence: evidenceFrom(view, "Create the coaching form") } : {}),
        },
      };
    });
    t.loopModel!(model);
    const thread = t.thread();
    for (const turn of [A1.T1, A1.T2, A1.T3]) await thread.say(turn);
    expect(thread.proposal?.locationId, "the case proves nothing: T3's card is not at O Street").toBe("loc-0311");
    const views = model.views.length;
    const fourth = await thread.say(A1.T4);
    const checked = model.views.slice(views).some((view) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /salon \(/.test(turn.text)));
    expect(checked, "the true salon claim was handed back as a mismatch").toBe(false);
    expect(fourth.content, `the true salon claim was replaced:\n${fourth.content}`).toMatch(/filed at \*\*NE Lincoln O Street\*\*/);
  }),
  loopCase("nov22-r3-a1a-control-team-card-salon-on-record", "Round 3 A1(a), control: a team card filed at a salon, then a turn with no card whose reply says it is filed there — kept (the team card's salon is on the record too)", async (t) => {
    vi.setSystemTime(new Date("2026-11-22T15:41:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", TWO_SALONS);
    const T1 = "can you create a coaching form for my whole staff at kearney?";
    const T2 = "thanks";
    const model = loopStandIn((view): LoopDecision => {
      if (said(view) === T2) return { text: "The team Coaching card is filed at **NE Kearney**." };
      if (lastResult(view, "coach_team")) return { text: "Here's the team Coaching card." };
      return { tool: "coach_team", input: {} };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say(T1);
    expect((thread.proposal as { subject?: string } | null)?.subject, "the case proves nothing: no team card").toBe("team");
    expect(thread.proposal?.locationId, "the case proves nothing: the team card has no salon").toBe("loc-0309");
    const views = model.views.length;
    const second = await thread.say(T2);
    const checked = model.views.slice(views).some((view) => view.turns.some((turn) => /^\[app check\]/.test(turn.text)));
    expect(checked, "the true salon claim was handed back").toBe(false);
    expect(second.content).toMatch(/filed at \*\*NE Kearney\*\*/);
  }),
  ...[true, false].map((fixes): ReplayCase =>
    loopCase(
      fixes ? "nov22-r3-a7-woven-line-without-woven-handed-back" : "nov22-r3-a7-woven-line-without-woven-left-out",
      fixes
        ? "Round 3 A7: the reply's \"Filed at <salon>, where Woven lists <P>\" when the manager named the salon (no salon_from_woven) goes back once and is said as the manager's"
        : "Round 3 A7: the model repeating \"where Woven lists <P>\" after the hand-back — that sentence is left out; the card is unchanged",
      async (t) => {
        vi.setSystemTime(new Date("2026-11-22T15:33:00Z"));
        t.directory([...STAFF, THESSALY]);
        t.as("salon_director", TWO_SALONS);
        const checked = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /lists the employee/.test(turn.text));
        const model = loopStandIn((view): LoopDecision => {
          if (lastResult(view, "propose_form")) {
            return { text: checked(view) && fixes ? "Here's the Corrective Action Form for **Thessaly**.\n\nFiled at **NE Kearney**, as you said." : "Here's the Corrective Action Form for **Thessaly**.\n\nFiled at **NE Kearney**, where Woven lists Thessaly; say if it's another salon. The card above is still open." };
          }
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: THESSALY.id, what_happened: A7_ACCOUNT, policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "thessaly wrenbrook") } };
        });
        t.loopModel!(model);
        const thread = t.thread();
        const reply = await thread.say(A7_T1);
        expect(thread.proposal?.locationId).toBe("loc-0309");
        expect(model.views.some(checked), "the Woven line with no Woven salon was never handed back").toBe(true);
        expect(reply.content, `the reply still says Woven placed the card:\n${reply.content}`).not.toMatch(/where Woven lists/i);
        expect(reply.content).toMatch(fixes ? /as you said/ : /The card above is still open\./);
      },
    ),
  ),
];
