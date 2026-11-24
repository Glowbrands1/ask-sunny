import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SALON, WRITTEN AS AN ASIDE, LEAVES THE ACCOUNT WITH ITS COMMAS (port of Ask Bubbles #1078; its QA's live re-run, 23 Nov 2026, A1)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same `withoutNamedSalon` in Sunny. The tester's three turns, word for word, with Sunny's salon
 * and job title for the sibling app's store and title, and an invented person (the R13 cases' Testy Testerson, spelled
 * the same in T1 and T3: the tester's T1 misspelling is left out, as Sunny's person-change guard asks for a new form's
 * evidence on a changed name, which is not what this case tests): on the sibling app's production the T3 card read "<First>, was 10
 * minutes late to the shift on 10/5.": the model wrote the store as an aside ("<P>, at <store>, was …"), and the strip
 * took the phrase and its closing comma but left the opening one. Now a salon phrase between two commas leaves with one
 * of them, and a comma that closes an earlier aside (", a tanning consultant at Kearney, was") stays.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port of Ask Bubbles #1078 (its QA's live re-run, 23 Nov 2026, A1): after \"Her name is <P> and she is at <store>\", the card's account read \"<First>, was 10 minutes late …\"";
const T1 = "My employee testy testerson has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15";
const T2 = "I already told you the employee name. She is at Kearney";
const T3 = "Create the coaching form with the information given. Her name is testy testerson and she is at Kearney. She is a tanning consultant";
const ACCOUNT_T1 = "Testy Testerson was 10 minutes late to the shift on 10/5. Testy Testerson was verbally coached on the attendance policy and expectations. Testy Testerson was late again on 10/15.";

const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const issueOf = (proposal: unknown) => (proposal as { issue?: string | null } | null)?.issue ?? "";

/** The live model: T1–T2 a Corrective Action card; T3 the Coaching Form, with the T3 account `t3Account`. */
const live = (t3Account: string) =>
  loopStandIn((view): LoopDecision => {
    const message = said(view);
    if (lastResult(view, "propose_form")) return { text: "Here's the card." };
    const coaching = message === T3;
    return {
      tool: "propose_form",
      input: {
        template_key: coaching ? "coaching" : "dpoa",
        employee_name: "Testy Testerson",
        what_happened: coaching ? t3Account : ACCOUNT_T1,
        incident_date: "2026-10-05",
        policy: headingWith(view, /attendance/i),
        person_evidence: evidenceFrom(view, "testy testerson", back(view, coaching ? T3 : T1)),
        attendance: "lateness",
        attendance_evidence: evidenceFrom(view, "was 10 minutes late on her last two shifts", back(view, T1)),
        ...(coaching ? { form_change_evidence: evidenceFrom(view, "Create the coaching form") } : {}),
      },
    };
  });

async function chat(t: ReplayContext, t3Account: string) {
  vi.setSystemTime(new Date("2026-11-23T01:47:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(live(t3Account));
  const thread = t.thread();
  for (const turn of [T1, T2, T3]) await thread.say(turn);
  expect(thread.proposal?.templateKey, "the case proves nothing: T3 made no Coaching card").toBe("coaching");
  expect(thread.proposal?.locationId, "the case proves nothing: the card is not filed at the salon the manager named").toBe("loc-0309");
  return issueOf(thread.proposal);
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    /* The model's account is the stand-in's, so the case runs offline only. */
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_SALON_ASIDE_COMMA_CASES: ReplayCase[] = [
  loopCase(
    "nov23-a1-salon-aside-leaves-with-its-commas",
    "A1 T3 \"… Her name is testy testerson and she is at Kearney …\": the model's \"Testy Testerson, at Kearney, was 10 minutes late …\" becomes \"Testy was 10 minutes late …\", never \"Testy, was …\"",
    async (t) => {
      const issue = await chat(t, "Testy Testerson, at Kearney, was 10 minutes late to the shift on 10/5. Testy Testerson was verbally coached on the attendance policy and expectations. Testy Testerson was late again on 10/15.");
      expect(issue, "a comma was left where the salon was").not.toMatch(/Testy,\s*was/);
      expect(issue).toMatch(/^Testy was 10 minutes late to the shift on 10\/5\./);
      expect(issue).not.toMatch(/Kearney/i);
    },
  ),
  loopCase(
    "nov23-a1-salon-aside-with-state-leaves-with-its-commas",
    "A1 T3, the aside with the salon's state (Sunny reads the state with the phrase, R13): \"Testy Testerson, at Kearney, NE, was …\" becomes \"Testy was …\", never \"Testy,, was …\"",
    async (t) => {
      const issue = await chat(t, "Testy Testerson, at Kearney, NE, was 10 minutes late to the shift on 10/5. Testy Testerson was verbally coached on the attendance policy and expectations. Testy Testerson was late again on 10/15.");
      expect(issue, "a comma was left where the salon was").not.toMatch(/Testy,+\s*was/);
      expect(issue).toMatch(/^Testy was 10 minutes late to the shift on 10\/5\./);
      expect(issue).not.toMatch(/Kearney|\bNE\b/);
    },
  ),
  loopCase(
    "nov23-a1-salon-after-title-aside-keeps-closing-comma",
    "A1 T3, the salon after the title in one aside: \"Testy Testerson, a tanning consultant at Kearney, was …\" becomes \"Testy, a tanning consultant, was …\"",
    async (t) => {
      const issue = await chat(t, "Testy Testerson, a tanning consultant at Kearney, was 10 minutes late to the shift on 10/5. Testy Testerson was verbally coached on the attendance policy and expectations. Testy Testerson was late again on 10/15.");
      expect(issue, "the aside lost its closing comma").toMatch(/^Testy, a tanning consultant, was 10 minutes late/);
      expect(issue).not.toMatch(/Kearney/i);
    },
  ),
];
