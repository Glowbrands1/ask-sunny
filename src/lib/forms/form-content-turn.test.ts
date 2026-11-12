import { describe, expect, it } from "vitest";

import { formContentQuestion, formContentRevision, honestFormReply } from "./form-content-turn";

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

describe("formContentRevision (ported from the Ask Bubbles live check, 31 Oct 2026)", () => {
  const guide = {
    id: "a1",
    role: "assistant" as const,
    content: "Spray the acrylic with the Approved Cleaner. Use Bed Status to mark it down. Submit a Help Desk request.",
  };

  it('"these details" whose words read as other people: the answer goes as the last turn, the request names nobody', () => {
    const turn = formContentRevision({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: [guide] })!;
    expect(turn.question).toBe("Add the details in my last message to the Details of Coaching.");
    expect(turn.history.at(-1)).toMatchObject({ role: "user", content: guide.content });
  });

  it("an answer naming nobody stays in the request, as before", () => {
    const plain = { id: "a1", role: "assistant" as const, content: "Wipe the bed, replace the towel and check the room before the next guest." };
    const turn = formContentRevision({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: [plain] })!;
    expect(turn.question).toBe("Add this to the Details of Coaching: Wipe the bed, replace the towel and check the room before the next guest.");
    expect(turn.history).toEqual([plain]);
  });

  it("the manager's own words naming somebody else keep the revision's rule", () => {
    const said = "this is what i am wanting to coach on: Jordan Blake showed the team how to clean the beds";
    expect(formContentRevision({ ...OPEN, question: said, history: [] })!.question).toBe(`Add this to the Details of Coaching: ${said}`);
  });

  it('"make that update" after a reply that offered no update is not a change', () => {
    const meta = { role: "assistant" as const, content: "It should update automatically — no copy-and-paste needed." };
    expect(formContentQuestion({ ...OPEN, question: "make that update", history: [meta] })).toBeNull();
  });
});

describe("independent review, 31 Oct 2026", () => {
  it.each([
    "Marnie was late 3 times this week what should I put for the policy",
    "Marnie needs to sign this before Friday, remind me",
  ])("a question or an errand about the employee is not written: %s", (said) => {
    expect(formContentQuestion({ ...OPEN, question: said, history: [] })).toBeNull();
  });

  it('"Add the details that she clocked out early on 10/20" gives its own details, never the previous answer', () => {
    const turn = formContentQuestion({ ...OPEN, question: "Add the details that she clocked out early on 10/20", history: [PRINTED] });
    expect(turn ?? "").not.toContain("rooms are checked before each guest");
    expect(turn ?? "").not.toContain("rooms are checked before each guest");
  });

  it("the honest reply's own lines are never content for \"make that update\"", () => {
    const honest = honestFormReply("Here's the updated **Coaching Form** for Marnie Holloway.\n\n**Details of Coaching:** Observed: late twice.", true)!;
    const turn = formContentQuestion({ ...OPEN, question: "make that update", history: [{ role: "assistant", content: honest }] })!;
    expect(turn).toBe("Add this to the Details of Coaching: Observed: late twice.");
  });

  it('a policy answer\'s "last updated the first quarter" is not a claim about the form', () => {
    expect(honestFormReply("The attendance policy was last updated the first quarter.\n\nIt applies to every shift.", true)).toBeNull();
  });
});

describe("independent review item 12, 31 Oct 2026", () => {
  it.each([
    "What's the date on the form for these details?",
    "I want to coach on the new dress code, what does the manual say?",
    "Marnie asked me to move her shift on Saturday",
  ])("never written into the Details: %s", (said) => {
    expect(formContentQuestion({ ...OPEN, question: said, history: [PRINTED] })).toBeNull();
  });
});

/*
 * DETAILS_FROM_EARLIER_ANSWER_ENABLED (chat-edits (a), relayed 5 Nov 2026): the details were the app's answer BEFORE the
 * card; then the card and the app's own "I haven't changed …" came after it. The person is invented (Rowan Kestrel).
 */
describe("DETAILS_FROM_EARLIER_ANSWER_ENABLED", () => {
  const history: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: "how do i coach on the spray tan booth?" },
    { role: "assistant", content: "Here's how to coach on the spray tan booth:\n\n**Details of Coaching:** Press **Start Session** only once the guest is in the booth and ready." },
    { role: "user", content: "Create a coaching form for Rowan Kestrel" },
    { role: "assistant", content: "Here is what I would put on a **Coaching Form**.\n\nCreate the draft here when you're ready." },
    { role: "user", content: "it didnt edit in the card" },
    { role: "assistant", content: "I haven't changed the **Coaching Form** for **Rowan Kestrel** — everything on it is as it was.\n\nTell me which part to change and what it should say, and I'll update just that." },
  ];
  const ask = (question: string) => formContentQuestion({ question, history, templateName: "Coaching Form", employeeName: "Rowan Kestrel" });

  it("reads \"the details we just discussed\" from the answer before the app's own card and edit replies", () => {
    process.env.FORM_EDIT_REFERS_BACK_ENABLED = "true";
    try {
      expect(ask("the details we just discussed!!!") ?? "").not.toMatch(/guest is in the booth/);
      process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED = "true";
      // (On one line, "Start" goes to the revision as "begin", as every content turn's does.)
      expect(ask("the details we just discussed!!!")).toMatch(/^Add this to the Details of Coaching: Press \*\*begin Session\*\* only once the guest is in the booth/);
      // "make that update" keeps its rule: the last reply offered nothing.
      expect(ask("make that update")).toBeNull();
    } finally {
      delete process.env.FORM_EDIT_REFERS_BACK_ENABLED;
      delete process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED;
    }
  });
});

/*
 * Ported from Ask Bubbles (Gate-Bubbles-4, 12 Nov 2026): "can you upate the draft with these details of coaching?" with
 * no earlier content answer in the chat. The flag-on reading is the flag-off one, never nothing (which sent the turn to
 * the free chat model). Invented person.
 */
describe("DETAILS_FROM_EARLIER_ANSWER_ENABLED, no earlier content answer", () => {
  const history: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: "Create a coaching form." },
    { role: "assistant", content: "Who is this **Coaching Form** for?" },
    { role: "user", content: "Oswin" },
    { role: "assistant", content: "Is this for **Oswin Marchbank**?" },
    { role: "user", content: "yes" },
    { role: "assistant", content: "Here is what I would put on a **Coaching Form**.\n\nCreate the draft here when you're ready." },
    { role: "user", content: "spray tan booth, when to reset it and when to restock the solution" },
    { role: "assistant", content: "I haven't changed the **Coaching Form** for **Oswin Marchbank** — everything on it is as it was." },
  ];
  const ask = () =>
    formContentQuestion({ question: "can you upate the draft with these details of coaching?", history, templateName: "Coaching Form", employeeName: "Oswin Marchbank" });

  it("flag on reads the turn as the flag-off reading does", () => {
    const saved = process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED;
    delete process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED;
    const off = ask();
    process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED = "true";
    try {
      expect(ask()).toEqual(off);
    } finally {
      if (saved === undefined) delete process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED;
      else process.env.DETAILS_FROM_EARLIER_ANSWER_ENABLED = saved;
    }
  });
});
