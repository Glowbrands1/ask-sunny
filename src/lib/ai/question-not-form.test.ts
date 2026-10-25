import { describe, expect, it } from "vitest";

import { isQuestionNotForm } from "./question-not-form";

/**
 * The managers' exact words from the 25 Oct 2026 live replays (and the
 * August conversation with the same "should i do a coaching" turn), read by
 * the one question test every form path asks first. Synthetic names.
 */

const ANSWERED = {
  role: "assistant",
  content:
    "If this is heading toward a documented conversation with someone, ask me to create a coaching form or a policy review for them.",
};

describe("a question is answered, never a form turn", () => {
  it.each([
    "how many hours is a part-time tanning consultant?",
    "what qualities do we look for before hiring a tanning consultant?",
    "what's policy on bereavement",
    "whats policy about smoke breaks",
    "whats policy about brining pets into salon",
    "employee has been late twice. should i do a coaching or corrective action",
    "should i do a coaching or corrective action",
    "smoking policy",
    "difference between ca and coaching form",
    "hey what policies can you write someone up for not signing a memebership up on a credit card",
    "footwear for employees",
    "policy specific to uggs?",
    "what policy does that fall under?",
    "what policy is violated when employee fails to have client sign waiver",
    "What does our policy say about attendance?",
    "do we have a coaching form?",
    "does that need a CA?",
    "did the policy change this year?",
    "how do I create a coaching form?",
  ])("%s", (question) => {
    expect(isQuestionNotForm(question, [ANSWERED])).toBe(true);
  });
});

describe("a create or edit request, or a statement, stays on the form path", () => {
  it.each([
    "create a CA for Test Employee",
    "can you create a CA for Test Employee?",
    "Can you create a coaching form and a policy review? I'd like to see both",
    "write a coaching for Test Employee",
    "create a coaching document for Test Employee regarding not completing closing duties",
    "create a verbal CA for Test Employee at Lawrence for a late opening on 10-20-26",
    "change the date to 10-22",
    "can you change the date to 10-22?",
    "can you edit the form I already finalized for Test Employee? change the date to 10-20-26",
    "can you add late opening policy to the direct policy section of this from",
    "can you reference the late opening policy INSTEAD of the attendance policy",
    "Create an exit form for Test Employee, she resigned and her last day was 10-20",
    "assist with creating an exit form",
    "do a ca and cite the standards of conduct as the policy violated",
    "Can you make a weekly coaching for how to get efts",
    "can you clean up my grammar and capitalizing on proper nouns?",
    "Can you make it generic so if the problem occurs elsewhere it can be used for any employee?",
    "can I get a CA for Test Employee?",
    "is it possible to create a coaching form for Test Employee?",
    "I need a CA for someone opening the salon late",
    "Her name is Test Employee",
    "Test Employee, Tanning Consultant, KS Manhattan, today",
    "I have an employee that is not verifying documents are signed",
    "Okay let's restart. Test Employee, Tanning Consultant, KS Manhattan. Not completing closing duties",
    "she violated the attendance policy",
    "I explained the attendance policy",
    "do verbal for team member Test Employee. payroll deduct does not apply. on 10-22-26 Test Employee came in to show her team her new puppy",
    "do a written for Test Employee",
    "we reviewed the cell phone policy",
    "the coaching covers the attendance policy",
    "what happened was she opened late on 10-20",
    "how about a verbal warning instead",
    "yes",
    "1",
    "Test Employee",
  ])("%s", (question) => {
    expect(isQuestionNotForm(question, [ANSWERED])).toBe(false);
  });

  it("a bare policy answering the assistant's question is the answer, not a lookup", () => {
    const asked = { role: "assistant", content: "Which policy should go on the form?" };
    expect(isQuestionNotForm("attendance policy", [asked])).toBe(false);
    const card = {
      role: "assistant",
      content: "**Which policy applies?** Reply with the number.\n1. **Cell Phone/Smart Watch Policy** (page 19)\n2. **Social Media Policy** (page 22)",
    };
    expect(isQuestionNotForm("the cell phone policy", [card])).toBe(false);
    expect(isQuestionNotForm("social media policy", [card])).toBe(false);
    expect(isQuestionNotForm("attendance policy", [ANSWERED])).toBe(true);
  });
});
