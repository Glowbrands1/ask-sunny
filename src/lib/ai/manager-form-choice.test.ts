import { afterEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { chosenFormQuestion, withManagerFormChoice } from "./manager-form-choice";
import type { AskRequest } from "./types";

/**
 * Ask Bubbles conv_mvofmpei2c50lhp, 25 Oct 2026: the manager's turns
 * exactly ("salon" for "store" in this app; the name is invented).
 */
const FLAG = "MANAGER_FORM_CHOICE_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const NEEDS = "an employee opened the salon 15 min late and needs CA";
const WRITE = "write ca";
const BUTTON = "Create a form from this conversation.";

describe("off", () => {
  it("reads every turn as typed", () => {
    delete process.env[FLAG];
    const request = { question: BUTTON, history: [{ role: "user", content: NEEDS }] } as unknown as AskRequest;
    expect(withManagerFormChoice(request)).toBe(request);
    // What main does with them: a question about the process, and the form selector.
    expect(detectTemplateIntent(NEEDS)).toEqual({ kind: "corrective_action", requestedCreation: false });
    expect(detectTemplateIntent(BUTTON)).toEqual({ kind: "ambiguous" });
  });
});

describe("on", () => {
  it("reads 'needs CA' and 'write ca' as the request for the Corrective Action Form", () => {
    process.env[FLAG] = "on";
    for (const turn of [NEEDS, WRITE, NEEDS.toUpperCase(), WRITE.toUpperCase(), "Write CA", "Write ca", "do a ca", NEEDS[0]!.toUpperCase() + NEEDS.slice(1)]) {
      const question = chosenFormQuestion(turn, []);
      expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
      expect(question.endsWith(turn)).toBe(true);
    }
  });

  it("uses the form the manager named for the generic button", () => {
    process.env[FLAG] = "on";
    const out = withManagerFormChoice({
      question: BUTTON,
      history: [
        { role: "user", content: NEEDS },
        { role: "assistant", content: "…" },
        { role: "user", content: "name is avery stone who is an assistant salon director. open late on 9-20-26." },
      ],
    } as unknown as AskRequest);
    expect(out.question).toBe("Create a Corrective Action Form from this conversation.");
    expect(detectTemplateIntent(out.question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it("keeps the form selector when no form was named, and a named form as typed", () => {
    process.env[FLAG] = "on";
    expect(chosenFormQuestion(BUTTON, ["she was late twice this week"])).toBe(BUTTON);
    expect(chosenFormQuestion("Create a Coaching Form from this conversation.", [NEEDS])).toBe("Create a Coaching Form from this conversation.");
    expect(chosenFormQuestion("how does the corrective action process work?", [])).toBe("how does the corrective action process work?");
    expect(chosenFormQuestion("what does the ca policy say about late opening?", [])).toBe("what does the ca policy say about late opening?");
    expect(chosenFormQuestion("show me the ca for avery stone", [])).toBe("show me the ca for avery stone");
    expect(chosenFormQuestion(BUTTON.toUpperCase(), [NEEDS])).toBe("Create a Corrective Action Form from this conversation.");
    expect(chosenFormQuestion("create a form", [WRITE])).toBe("Create a Corrective Action Form from this conversation.");
    expect(chosenFormQuestion(BUTTON, ["create a coaching form for avery stone"])).toBe("Create a Coaching Form from this conversation.");
  });
});
