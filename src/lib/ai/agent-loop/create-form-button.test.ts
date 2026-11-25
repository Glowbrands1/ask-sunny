import { afterEach, describe, expect, it, vi } from "vitest";

import { CREATE_FORM_FROM_CONVERSATION } from "@/lib/forms/proposal-continuation";

import { createFormButtonLine, createFormButtonNoCardNote, isCreateFormButtonTurn } from "./create-form-button";
import { agentLoopSystem } from "./prompt";

/*
 * Pau (25 Nov 2026): a manager pressed "Create a form from this conversation" three times; Sunny kept telling them to
 * press Create draft themselves, then said no new card was made because a draft was already open. The button's turn tells
 * the loop it was pressed and what is on screen (CREATE_FORM_BUTTON_PICKS_FORM_ENABLED).
 */
const base = { managerName: "Kearney", role: "salon_director", salons: ["NE Omaha"], today: "2026-11-25", templates: [{ key: "dpoa", name: "Corrective Action Form" }], headings: [] };

afterEach(() => vi.unstubAllEnvs());

describe("CREATE_FORM_BUTTON_PICKS_FORM", () => {
  it("knows the button by its own sentence, only with the flag on", () => {
    expect(isCreateFormButtonTurn(CREATE_FORM_FROM_CONVERSATION)).toBe(false);
    vi.stubEnv("CREATE_FORM_BUTTON_PICKS_FORM_ENABLED", "1");
    expect(isCreateFormButtonTurn(CREATE_FORM_FROM_CONVERSATION)).toBe(true);
    expect(isCreateFormButtonTurn("create a form from this conversation")).toBe(true);
    expect(isCreateFormButtonTurn("create it")).toBe(false);
    expect(isCreateFormButtonTurn("Create a coaching form from this conversation.")).toBe(false);
  });

  it("each screen gets its own instruction; the reply never points to Create draft without a card", () => {
    const nothing = createFormButtonLine({ kind: "nothing" }, "Form Monitoring");
    expect(nothing).toMatch(/Pick the one form in the list above that fits it and call propose_form/);
    const card = createFormButtonLine({ kind: "card_open", form: "Corrective Action Form" }, "Form Monitoring");
    expect(card).toMatch(/The Corrective Action Form card from your last reply is on their screen/);
    expect(card).toMatch(/Call propose_form for it again now/);
    const draft = createFormButtonLine({ kind: "draft_open" }, "Form Monitoring");
    expect(draft).toMatch(/saved as a draft in Form Monitoring, and that nothing new was made/);
    for (const line of [nothing, card, draft]) expect(line).toMatch(/Never tell them to press Create draft unless THIS reply carries a card/);
    expect(createFormButtonNoCardNote("Corrective Action Form")).toMatch(/^\[app check\].*the Corrective Action Form card on screen/);
  });

  it("reaches the loop's turn facts only when given", () => {
    expect(agentLoopSystem({ ...base, openFormId: null })).not.toMatch(/create_form_button/);
    expect(agentLoopSystem({ ...base, openFormId: "inst-1", createFormButton: { kind: "draft_open" } })).toMatch(/create_form_button: .*A draft is open on their screen/);
  });
});
