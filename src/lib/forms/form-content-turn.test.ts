import { describe, expect, it } from "vitest";

import { formContentQuestion, honestFormReply } from "./form-content-turn";

/** Port from the sibling app (QA, 30 Oct 2026): its managers' turns, the company details swapped. Names are invented. */
const OPEN = { templateName: "Coaching Form", employeeName: "Marnie Holloway" };
const PRINTED = { role: "assistant" as const, content: "Here's the update applied to the draft: **Details of Coaching:** Observed: the checklist is done in order." };

describe("formContentQuestion", () => {
  it("details in plain words", () => {
    const said = "this is what i am wanting to coach on: running the opening checklist";
    expect(formContentQuestion({ ...OPEN, question: said, history: [] })).toBe(`Add this to the Details of Coaching: ${said}`);
  });

  it('"make that update": the Details the previous reply printed, without its claim', () => {
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [PRINTED] })).toBe(
      "Add this to the Details of Coaching: Observed: the checklist is done in order.",
    );
  });

  it('"make that update" with nothing before it: not a change', () => {
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [] })).toBeNull();
  });

  // "start" goes to the revision as "begin": the revision reads "start" anywhere as a request for another form.
  it('"can you upate the draft with these details of coaching?": the previous answer', () => {
    const guide = { role: "assistant" as const, content: "Unlock, start the music, check each room and log it." };
    expect(formContentQuestion({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: [guide] })).toBe(
      "Add this to the Details of Coaching: Unlock, begin the music, check each room and log it.",
    );
  });

  it.each(["how long has Marnie worked here?", "Is Marnie on the schedule Saturday", "Marnie was late"])(
    "a question, or too short to be an account, is not a change: %s",
    (said) => {
      expect(formContentQuestion({ ...OPEN, question: said, history: [] })).toBeNull();
    },
  );

  it("only the Coaching Form", () => {
    expect(
      formContentQuestion({ templateName: "Corrective Action Form", employeeName: "Marnie Holloway", question: "make that update", history: [PRINTED] }),
    ).toBeNull();
  });
});

describe("honestFormReply", () => {
  it("drops the claim and says nothing changed, keeping what it drafted", () => {
    const reply = honestFormReply("Here's the updated **Coaching Form** for Marnie Holloway.\n\nObserved: the checklist is done.", true)!;
    expect(reply).not.toMatch(/here's the updated/i);
    expect(reply).toMatch(/^\*\*Nothing on the form has changed yet\.\*\*/);
    expect(reply).toContain("Observed: the checklist is done.");
    expect(reply).toContain("make that update");
  });

  it("an answer that claims nothing is left as it is", () => {
    expect(honestFormReply("Press Finalize on the card when it is ready.", true)).toBeNull();
  });
});
