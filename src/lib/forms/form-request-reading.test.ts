import { describe, expect, it } from "vitest";

import { extractEmployeeNames, resolveEmployee, managerContext } from "./proposal";
import { detectTemplateIntent, isFormVocabulary } from "./template-intent";
import { TEMPLATE_SEEDS } from "./library";

/**
 * ============================================================================
 * ASKING FOR A FORM BY NAME MUST NOT COST YOU THE EMPLOYEE
 * ============================================================================
 *
 * Typed into Preview:
 *
 *   "Coaching Form for Sarah Test, she was late today"
 *
 * and Ask Sunny answered "I don't yet know who this form is about." It had read
 * TWO people out of that sentence — "Coaching Form" and "Sarah Test" — so the
 * turn was ambiguous and the honest response to an ambiguous turn is to ask.
 * The reading was the bug, not the asking.
 *
 * Every template whose name is two capitalised words had the same fault, which
 * is why the fixtures below sweep the published library rather than checking
 * the one sentence that was reported.
 */

const NAMES = TEMPLATE_SEEDS.map((seed) => seed.name);

describe("a form's own name is never read as a person", () => {
  it("reads the employee out of the sentence that failed in Preview", () => {
    expect(extractEmployeeNames("Coaching Form for Sarah Test, she was late today")).toEqual([
      "Sarah Test",
    ]);
  });

  it("does the same for every published template name", () => {
    /*
     * GUARD ON THE GUARD: each sentence really does contain a capitalised form
     * name, so a reader that simply ignored capitalisation would pass this by
     * accident. `Sarah Test` has to come back, alone, from all of them.
     */
    for (const name of NAMES) {
      const sentence = `${name} for Sarah Test, she was late today`;
      expect(sentence).toContain(name);
      expect(extractEmployeeNames(sentence), name).toEqual(["Sarah Test"]);
    }
  });

  it("resolves rather than asking, on that conversation", () => {
    const context = managerContext([], {
      content: "Coaching Form for Sarah Test, she was late today",
    });
    expect(resolveEmployee(context)).toEqual({ kind: "resolved", employeeName: "Sarah Test" });
  });

  it("still refuses to invent a name when none was given", () => {
    // The conservatism this reader was written for has to survive the fix.
    for (const sentence of [
      "Coaching Form please",
      "Create a coaching form for a performance concern",
      "I need a coaching form for one of my staff",
    ]) {
      expect(extractEmployeeNames(sentence), sentence).toEqual([]);
    }
    expect(resolveEmployee(managerContext([], { content: "Coaching Form please" }))).toEqual({
      kind: "missing",
    });
  });

  it("still reads a bare name typed in answer to the question", () => {
    expect(extractEmployeeNames("Sarah Test")).toEqual(["Sarah Test"]);
  });

  it("still reports two real people as ambiguous", () => {
    // The mechanism that caught the false positive must keep catching the true
    // one: two employees in one sentence is a question, not a guess.
    expect(extractEmployeeNames("Coaching Form for Sarah Test and Maria Lopez")).toEqual([
      "Sarah Test",
      "Maria Lopez",
    ]);
  });

  it("knows form words from name words", () => {
    for (const word of ["coaching", "form", "policy", "review", "interview", "epp", "plan"]) {
      expect(isFormVocabulary(word), word).toBe(true);
    }
    for (const word of ["Sarah", "Test", "Maria", "Lopez", "Jordan"]) {
      expect(isFormVocabulary(word), word).toBe(false);
    }
  });
});

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION" MEANS THIS CONVERSATION
 * ============================================================================
 *
 * The rail button sends a deliberately generic sentence, which reads as
 * ambiguous on its own — correctly, because with nothing said yet the honest
 * answer is the list. But a manager who has ALREADY named the form is asked
 * again, which is the assistant forgetting a sentence still on screen.
 *
 * These test the reading only; `intentForTurn` wires it to the rail and is
 * covered where the route is.
 */
describe("what the manager already said about which form", () => {
  const history = [
    { id: "m1", role: "user" as const, content: "Coaching Form for Sarah Test, she was late today" },
    { id: "a1", role: "assistant" as const, content: "Here is what I would put on a Coaching Form." },
  ];

  it("reads the rail's own sentence as ambiguous on its own", () => {
    expect(detectTemplateIntent("Create a form from this conversation.")).toEqual({
      kind: "ambiguous",
    });
  });

  it("finds the form the manager named in an earlier turn", () => {
    const context = managerContext(history, { content: "Create a form from this conversation." });
    const named = [...context.messages]
      .reverse()
      .map((message) => detectTemplateIntent(message.content))
      .find((intent) => intent.kind === "explicit");

    expect(named).toEqual({ kind: "explicit", templateKey: "coaching" });
  });

  it("reads the employee from those same turns", () => {
    const context = managerContext(history, { content: "Create a form from this conversation." });
    expect(resolveEmployee(context)).toEqual({ kind: "resolved", employeeName: "Sarah Test" });
  });

  it("never takes the form name from an ASSISTANT turn", () => {
    /*
     * The assistant says "Coaching Form" constantly — in the proposal card, in
     * the library listing, in its own escape copy. `managerContext` keeps only
     * the manager's turns, so none of that can name a form on their behalf.
     */
    const assistantOnly = [
      { id: "a1", role: "assistant" as const, content: "Which form do you need? Coaching Form — the everyday documented coaching conversation." },
    ];
    const context = managerContext(assistantOnly, { content: "Create a form from this conversation." });

    expect(context.messages.every((message) => message.content !== assistantOnly[0].content)).toBe(true);
    const named = [...context.messages]
      .reverse()
      .map((message) => detectTemplateIntent(message.content))
      .find((intent) => intent.kind === "explicit");
    expect(named).toBeUndefined();
  });
});
