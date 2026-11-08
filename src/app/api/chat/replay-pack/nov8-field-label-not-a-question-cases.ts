import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "HOW EMPLOYEE RESIGNED - TOLD MANAGEMENT" FILLS THE OPEN EXIT CARD (QA, 8 Nov 2026, from the sibling app's live tester; the same here;
 * pre-existing; FIELD_LABEL_NOT_A_QUESTION_ENABLED)
 * ============================================================================
 *
 * A district manager's six-turn exit chat (6872309a), replayed word for word (the person and her address invented).
 * Turns 5 and 6 fill the card's own fields by their labels — "resignation date 10-26-2026. how employee resigned - …
 * Reason for resignation - …" and "how employee resigned - told management" — and were answered "A grounded answer
 * from the policy manual." with no card, in both apps: "how" was read as a question.
 */
const TURNS = [
  "create an exit for marnie holloway, assistant salon director at lees summit, mo. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire. marnie's address is 48 Ne Briar Hollow Lane, lees summit, MO. 64064",
  "marnie told management on 10-26-26 that she quit effective immediately due to personal reasons.",
  "exit is for marnie holloway",
  "create exit for marnie holloway",
  "resignation date 10-26-2026. how employee resigned - Marnie told management she quit effective immediately on 10-26-2026. Reason for resignation - Marnie quit due to personal family issues.",
  "how employee resigned - told management",
] as const;
const blank = (content: string) => content.split("\n").find((line) => line.startsWith("**Left blank for you to review:**")) ?? "";

export const NOV8_FIELD_LABEL_NOT_A_QUESTION_CASES: ReplayCase[] = [
  {
    id: "nov8-field-label-not-a-question",
    title: "an open exit card: \"how employee resigned - told management\" and \"resignation date … Reason for resignation - …\" fill the card, never a policy answer",
    report: "QA, 8 Nov 2026, from the sibling app's live tester; the same here (a district manager's chat, replayed): field-label turns answered as a policy question",
    // Changed on purpose (8 Nov 2026): fixed in production by FIELD_LABEL_NOT_A_QUESTION_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["FIELD_LABEL_NOT_A_QUESTION_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", TWO_SALONS);
      const thread = t.thread();
      const replies: string[] = [];
      for (const said of TURNS) replies.push((await thread.say(said)).content);
      for (const turn of [4, 5]) {
        const content = replies[turn]!;
        expect(content, `turn ${turn + 1} is answered as a question:\n${content}`).not.toMatch(/A grounded answer from the policy manual/);
        expect(content, `turn ${turn + 1} shows no exit card:\n${content}`).toMatch(/\*\*Resignation\/Exit Form\*\*/);
        expect(blank(content), `turn ${turn + 1} leaves How Employee Resigned blank:\n${content}`).not.toMatch(/How Employee Resigned/);
      }
    },
  },
  {
    id: "nov8-field-label-question-kept",
    title: "must not change: \"how employee resigned?\" with a question mark is still a question",
    report: "QA, 8 Nov 2026, from the sibling app's live tester; the same here (the negative)",
    status: "fixed",
    fixFlags: ["FIELD_LABEL_NOT_A_QUESTION_ENABLED"],
    async run(t) {
      const { isQuestionNotForm } = await import("@/lib/ai/question-not-form");
      vi.stubEnv("FIELD_LABEL_NOT_A_QUESTION_ENABLED", "true");
      expect(isQuestionNotForm("how employee resigned - what do I put here?")).toBe(true);
      expect(isQuestionNotForm("how employee resigned - told management")).toBe(false);
      void t;
    },
  },
];
