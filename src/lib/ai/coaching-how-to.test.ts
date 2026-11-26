import { describe, expect, it, vi } from "vitest";

import { adviceNotForm } from "./agent-loop/advice-not-form";
import { agentLoopRules } from "./agent-loop/prompt";
import { rulesBookText } from "./agent-loop/rules-book";
import { asksCoachingHowTo, coachingAnswerShape, coachingHowToNote, coachingHowToRule, SIGNATURE_RULE, withCoachingHowTo } from "./coaching-how-to";
import { buildSystemPrompt } from "./prompts";

/*
 * Owner, 26 Nov 2026: coaching how-to answers must always give managers a word-for-word script and an outline of the
 * conversation, plus a short checklist. The rules book's "a sample script or role-play" was permissive.
 */

const ASKS = [
  "how do I coach someone who keeps showing up late",
  "give me a script for talking to an employee about their attitude",
  "tips for a hard conversation with a leader about follow-ups",
];

describe("the coaching how-to rule", () => {
  const rule = coachingHowToRule("salon");

  it("requires the outline, the quoted script and the checklist, all three", () => {
    expect(rule).toMatch(/always all three/);
    expect(rule).toMatch(/short outline of the conversation, as a numbered list: the opening, the facts and the expectation, listening to their side, agreement on next steps, and a follow-up date/);
    expect(rule).toMatch(/sample script in quotation marks that the manager can read aloud word for word, tailored to the situation they described/);
    expect(rule).toMatch(/short checklist/);
  });

  it("cites the JBA Policy Manual by its title, proposes no form, and frames coaching as development", () => {
    expect(rule).toContain("JBA Policy Manual");
    expect(rule).toMatch(/never propose a form and never ask who a form is for; a closing line may offer one/);
    expect(rule).toMatch(/developing the person, naming a concern only when the manager described one/);
  });

  it("is in the agent loop's rules book and system prompt, and the old permissive wording is gone", () => {
    for (const text of [rulesBookText(), agentLoopRules()]) {
      expect(text).toContain(rule);
      expect(text).not.toContain("(steps, a checklist, a sample script or role-play)");
    }
  });

  it("is in the older chat prompt, both branches, after the signature-lines rule", () => {
    const build = () => buildSystemPrompt({
      assistantName: "Sunny", brandName: "Sun Tan City", salonNoun: "salon", mode: "standard", hasContext: true,
      context: { userName: "Test Manager", locationName: "Test Salon", todayIso: "2026-11-26" },
    } as never);
    for (const cached of ["false", "true"]) {
      vi.stubEnv("PROMPT_CACHE_ENABLED", cached);
      expect(build()).toContain(`${SIGNATURE_RULE}\n- ${rule}`);
    }
    vi.unstubAllEnvs();
    expect(withCoachingHowTo("no rule here", "salon")).toBe("no rule here");
  });
});

describe("coachingAnswerShape", () => {
  it("finds a numbered outline and a quoted script", () => {
    const reply = "1. Opening\n2. The facts\n3. Listen\n4. Next steps\n5. Follow-up\n\n\"I wanted to check in with you about the last few shifts and how we can fix it together.\"";
    expect(coachingAnswerShape(reply)).toEqual({ outline: true, script: true });
  });

  it("generic tips have neither", () => {
    expect(coachingAnswerShape("Be direct but kind, focus on the behavior, listen, and agree on next steps.")).toEqual({ outline: false, script: false });
  });

  it("a short quoted phrase is not a script; curly quotes and a blockquote are", () => {
    expect(coachingAnswerShape("Say \"thank you\" often.").script).toBe(false);
    expect(coachingAnswerShape("“I want to talk with you about being on time, because the team counts on you.”").script).toBe(true);
    expect(coachingAnswerShape("> I want to talk with you about being on time, because the team counts on you.").script).toBe(true);
  });
});

describe("asksCoachingHowTo, with adviceNotForm", () => {
  it.each(ASKS)("%s: advice about coaching", (said) => {
    expect(adviceNotForm(said)).toBe(true);
    expect(asksCoachingHowTo(said)).toBe(true);
  });

  it("a policy lookup is not a coaching how-to", () => {
    expect(asksCoachingHowTo("what's the PTO policy?")).toBe(false);
    expect(asksCoachingHowTo("what time does the salon open on Sunday?")).toBe(false);
  });

  it("the hand-back note names what is missing", () => {
    expect(coachingHowToNote({ outline: false, script: true })).toMatch(/is missing a short numbered outline/);
    expect(coachingHowToNote({ outline: true, script: false })).toMatch(/is missing a sample script in quotation marks/);
    expect(coachingHowToNote({ outline: false, script: false })).toMatch(/JBA Policy Manual/);
  });
});
