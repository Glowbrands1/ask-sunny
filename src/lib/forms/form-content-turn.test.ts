import { describe, expect, it } from "vitest";

import { formContentQuestion, honestFormReply } from "./form-content-turn";

/** Ported from Ask Bubbles (QA, 30 Oct 2026): the managers' own request wording with a Coaching Form draft open. Names are invented. */
const OPEN = { templateName: "Coaching Form", employeeName: "Marnie Holloway" };
const PRINTED = { role: "assistant" as const, content: "Here's the update applied to the draft: **Details of Coaching:** Observed: rooms are checked before each guest." };

describe("formContentQuestion", () => {
  it("details in plain words", () => {
    const said = "this is what i am wanting to coach on: getting rooms ready between guests";
    expect(formContentQuestion({ ...OPEN, question: said, history: [] })).toBe(`Add this to the Details of Coaching: ${said}`);
  });

  it('"make that update": the Details the previous reply printed, without its claim', () => {
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [PRINTED] })).toBe(
      "Add this to the Details of Coaching: Observed: rooms are checked before each guest.",
    );
  });

  it('"make that update" with nothing before it: not a change', () => {
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [] })).toBeNull();
  });

  it('"can you upate the draft with these details of coaching?": the previous answer', () => {
    const guide = { role: "assistant" as const, content: "Wipe the bed, replace the towel and check the room before the next guest." };
    expect(formContentQuestion({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: [guide] })).toBe(
      "Add this to the Details of Coaching: Wipe the bed, replace the towel and check the room before the next guest.",
    );
  });

  it.each(["how long has Marnie worked here?", "Is Marnie on the schedule Saturday", "Marnie was late"])(
    "a question, or too short to be an account, is not a change: %s",
    (said) => {
      expect(formContentQuestion({ ...OPEN, question: said, history: [] })).toBeNull();
    },
  );

  it('"start" and "create" in the account go to the revision as "begin" and "make" (the revision reads them as a new-form request)', () => {
    const printed = { role: "assistant" as const, content: "**Details of Coaching:** Start each turnover when the guest leaves; create a checklist for the room." };
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [printed] })).toBe(
      "Add this to the Details of Coaching: begin each turnover when the guest leaves; make a checklist for the room.",
    );
  });

  it("only the Coaching Form", () => {
    expect(
      formContentQuestion({ templateName: "Corrective Action Form", employeeName: "Marnie Holloway", question: "make that update", history: [PRINTED] }),
    ).toBeNull();
  });
});

describe("honestFormReply", () => {
  it("drops the claim and says nothing changed, keeping what it drafted", () => {
    const reply = honestFormReply("Here's the updated **Coaching Form** for Marnie Holloway.\n\nObserved: rooms are checked.", true)!;
    expect(reply).not.toMatch(/here's the updated/i);
    expect(reply).toMatch(/^\*\*Nothing on the form has changed yet\.\*\*/);
    expect(reply).toContain("Observed: rooms are checked.");
    expect(reply).toContain("make that update");
  });

  it("an answer that claims nothing is left as it is", () => {
    expect(honestFormReply("Press Finalize on the card when it is ready.", true)).toBeNull();
  });
});
