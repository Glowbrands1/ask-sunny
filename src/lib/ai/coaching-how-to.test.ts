import { describe, expect, it, vi } from "vitest";

import { adviceNotForm } from "./agent-loop/advice-not-form";
import { agentLoopRules } from "./agent-loop/prompt";
import { rulesBookText } from "./agent-loop/rules-book";
import { asksCoachingHowTo, asksHistoryFirstAdvice, coachingAnswerShape, coachingCardPrepRule, coachingHowToNote, coachingHowToRule, completeShape, HISTORY_FIRST_LINE, historyFirstNote, partsOf, SIGNATURE_RULE, withCoachingHowTo } from "./coaching-how-to";
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

  it("is a prep package: why, when, the outline, the quoted script, an analogy, a role-play, a measurable plan and a checklist", () => {
    expect(rule).toMatch(/is a prep package the manager can use, tuned to the topic/);
    expect(rule).toMatch(/\(1\) why it matters/);
    expect(rule).toMatch(/\(2\) when to have the conversation/);
    expect(rule).toMatch(/\(5\) a relatable analogy/);
    expect(rule).toMatch(/\(6\) a role-play to run together/);
    expect(rule).toMatch(/\(7\) a measurable action plan: what changes, how it is measured, and the follow-up date/);
    expect(rule).toMatch(/short outline of the conversation, as a numbered list: the opening, the facts and the expectation, listening to their side, agreement on next steps, and a follow-up date/);
    expect(rule).toMatch(/sample script in quotation marks that the manager can read aloud word for word/);
    expect(rule).toMatch(/short checklist/);
  });

  it("orders the struggling-employee answer and asks at most two questions", () => {
    expect(rule).toMatch(/struggling with <X>[\s\S]*coaching guidance first[\s\S]*Observed \/ Expectation \/ Practice \/ Follow-Up[\s\S]*role-play tied to the follow-up date[\s\S]*offering to make the form/);
    expect(rule).toMatch(/at most one or two quick questions/);
  });

  it("builds the package from the company's own coaching guidance first, naming the document (the owner, 26 Nov 2026)", () => {
    expect(rule).toMatch(/Build it from the company's own coaching guidance first: search the knowledge base \(search_knowledge, where you have it\) before you answer/);
    expect(rule).toMatch(/Performance Management Framework holds the coaching conversation structure with the lines to say, the "Help me coach this employee" answer format, role-play and the Management Diamond/);
    expect(rule).toMatch(/its \[placeholders\] filled in from what the manager described, and you name the document with its source marker; write your own wording only for a part no document covers/);
    const note = coachingHowToNote({ outline: true, script: true, rolePlay: true, plan: true }, false);
    expect(note).toMatch(/You answered without searching the knowledge base: call search_knowledge first/);
    expect(coachingHowToNote({ outline: true, script: true, rolePlay: true, plan: true }, true)).not.toMatch(/without searching/);
  });

  it("a Coaching card gets the prep above it, never on the card or the form", () => {
    expect(coachingCardPrepRule()).toMatch(/the reply above the card gives the prep package/);
    expect(coachingCardPrepRule()).toMatch(/never put it in what_happened, on the card or on the form/);
    expect(rulesBookText()).toContain(coachingCardPrepRule());
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
  it("finds a numbered outline, a quoted script, a role-play and a plan with a follow-up", () => {
    const reply = "1. Opening\n2. The facts\n3. Listen\n4. Next steps\n5. Follow-up\n\n\"I wanted to check in with you about the last few shifts and how we can fix it together.\"\n\nRole-play it once. Action plan: on time five shifts, follow-up next week.";
    expect(coachingAnswerShape(reply)).toEqual({ outline: true, script: true, rolePlay: true, plan: true });
    expect(completeShape(coachingAnswerShape(reply))).toBe(true);
  });

  it("generic tips have none of it", () => {
    const shape = coachingAnswerShape("Be direct but kind, focus on the behavior, listen, and agree on next steps.");
    expect(shape).toEqual({ outline: false, script: false, rolePlay: false, plan: false });
    expect(partsOf(shape)).toBe(0);
  });

  it("a short quoted phrase is not a script; curly quotes and a blockquote are", () => {
    expect(coachingAnswerShape("Say \"thank you\" often.").script).toBe(false);
    expect(coachingAnswerShape("“I want to talk with you about being on time, because the team counts on you.”").script).toBe(true);
    expect(coachingAnswerShape("> I want to talk with you about being on time, because the team counts on you.").script).toBe(true);
  });

  it("a plan needs its follow-up", () => {
    expect(coachingAnswerShape("Action plan: be on time.").plan).toBe(false);
    expect(coachingAnswerShape("Action plan: be on time; check in Friday.").plan).toBe(true);
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

  it("\"how do I help an employee who is struggling with upselling\" is advice about coaching", () => {
    expect(adviceNotForm("how do I help an employee who is struggling with upselling")).toBe(true);
    expect(asksCoachingHowTo("how do I help an employee who is struggling with upselling")).toBe(true);
  });

  it("the hand-back note names what is missing", () => {
    const all = { outline: true, script: true, rolePlay: true, plan: true };
    expect(coachingHowToNote({ ...all, outline: false })).toMatch(/is missing a short numbered outline/);
    expect(coachingHowToNote({ ...all, script: false })).toMatch(/is missing the words to use: a sample script in quotation marks/);
    expect(coachingHowToNote({ ...all, rolePlay: false })).toMatch(/is missing a role-play to run together/);
    expect(coachingHowToNote({ ...all, plan: false })).toMatch(/is missing a measurable action plan with a follow-up date/);
    expect(coachingHowToNote({ outline: false, script: false, rolePlay: false, plan: false })).toMatch(/JBA Policy Manual/);
  });
});

/*
 * The owner, 28 Nov 2026: "yes please both apps, same with CA". Coaching or corrective-action advice that names an
 * employee starts from that person's forms on file.
 */
describe("advice about a named employee starts from their forms on file", () => {
  it.each([
    "how do I coach Odile Fenwick who keeps showing up late",
    "should Odile get a written warning for being late again?",
    "tips for talking to odile fenwick about being late",
    "is it time to write up Odile?",
    "what should my next step be with Odile? she was late again",
  ])("%s: coaching or corrective-action advice", (said) => {
    expect(asksHistoryFirstAdvice(said)).toBe(true);
  });

  it.each([
    "write up Odile for being late today",
    "can you make a CA for Odile?",
    "can you write Odile up for being late?",
    "what's the PTO policy?",
    "what time does the salon open on Sunday?",
  ])("%s: not advice of that kind (a form request, or another topic)", (said) => {
    expect(asksHistoryFirstAdvice(said)).toBe(false);
  });

  it("is in the coaching rule, both prompts, and the rules book says such advice asks", () => {
    expect(coachingHowToRule("salon")).toContain(HISTORY_FIRST_LINE);
    expect(HISTORY_FIRST_LINE).toMatch(/that advice also asks about that person's forms on file: look at them first/);
    expect(HISTORY_FIRST_LINE).toMatch(/never decide the level for the manager/);
    expect(rulesBookText()).toMatch(/Coaching or corrective-action advice that names an employee[^.]*asks about that person's forms on file too/);
  });

  it("the hand-back note names the person and asks for find_past_forms with the manager's words", () => {
    const note = historyFirstNote("Odile Fenwick");
    expect(note).toMatch(/^\[app check\]/);
    expect(note).toMatch(/Call find_past_forms for Odile Fenwick now \(forms_on_file_evidence: the manager's words that name Odile Fenwick\)/);
    expect(note).toMatch(/Propose no form/);
  });
});
