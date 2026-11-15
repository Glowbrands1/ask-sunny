import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { asksAboutPastForms, WHICH_FORM_QUESTION } = await import("./tools");

const turn = (role: "user" | "assistant", content: string) => ({ id: `${role}-${content.length}`, role, content, createdAt: "2026-11-15T00:00:00Z" });

/* Batch G (G4, tightened by QA): the answer to the app's own which-form question opens the past-forms gate; nothing older does. */
describe("the past-forms gate and the answer to the app's own which-form question", () => {
  it("opens for the long answer right after the app's which-form question to an open request", () => {
    const history = [turn("user", "open my coaching form for remy calder"), turn("assistant", `Remy Calder has two Coaching Forms on file:\n- 10/31\n- 11/5\n\n${WHICH_FORM_QUESTION}`)];
    expect(asksAboutPastForms({ question: "the 10/31 one about getting rooms ready between guests", history })).toBe(true);
  });
  it("stays closed when the reply only ended with a question mark", () => {
    const history = [turn("user", "open my coaching form for remy calder"), turn("assistant", "Do you want the coaching form or the CA?")];
    expect(asksAboutPastForms({ question: "the 10/31 one about getting rooms ready between guests", history })).toBe(false);
  });
  it("stays closed for an old forms question three or more turns back and a long unrelated message", () => {
    const history = [
      turn("user", "open my coaching form for remy calder"),
      turn("assistant", `Remy Calder has two Coaching Forms on file:\n- 10/31\n- 11/5\n\n${WHICH_FORM_QUESTION}`),
      turn("user", "never mind that for now"),
      turn("assistant", "Okay."),
      turn("user", "what is the policy on breaks"),
      turn("assistant", "Breaks are covered in the Break Policy."),
    ];
    expect(asksAboutPastForms({ question: "can you tell me how the tanning bed cleaning checklist works for the evening shift", history })).toBe(false);
  });
});
