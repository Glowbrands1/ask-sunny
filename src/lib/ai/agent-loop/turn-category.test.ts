import { describe, expect, it } from "vitest";

import { loopTurnCategory } from "./turn-category";

/*
 * PR 4 (Pau's audit): a loop turn is logged by the tools it called, never "unclassified" and never from the message text.
 * Order: card, edit, open_form, past_forms, policy, chat.
 */
describe("loopTurnCategory", () => {
  it("a card is its form's own category", () => {
    expect(loopTurnCategory(["find_staff", "propose_form"], { formProposal: { templateKey: "dpoa" } })).toBe("corrective_action");
    expect(loopTurnCategory(["find_staff", "propose_form"], { formProposal: { templateKey: "coaching" } })).toBe("coaching_form");
  });
  it("a card the turn called for but did not return is a form request", () => {
    expect(loopTurnCategory(["propose_form"], {})).toBe("form_request");
  });
  it("an edit, an opened form and past forms are form requests", () => {
    for (const tool of ["edit_form", "open_form", "find_past_forms", "read_form"]) expect(loopTurnCategory([tool], {})).toBe("form_request");
  });
  it("a policy turn is the cited category, else a policy question", () => {
    expect(loopTurnCategory(["read_policy"], {})).toBe("policy_question");
    expect(loopTurnCategory(["search_knowledge"], { citations: [{ category: "training" }] })).toBe("training");
  });
  it("no tool, or a lookup tool, is chat (general guidance)", () => {
    expect(loopTurnCategory([], {})).toBe("general_guidance");
    expect(loopTurnCategory(["find_staff", "app_help"], {})).toBe("general_guidance");
  });
  it("the first that applies wins: a card over an edit over a policy", () => {
    expect(loopTurnCategory(["read_policy", "edit_form", "propose_form"], { formProposal: { templateKey: "dpoa" } })).toBe("corrective_action");
    expect(loopTurnCategory(["read_policy", "edit_form"], {})).toBe("form_request");
  });
  it("is never unclassified", () => {
    for (const tools of [[], ["find_staff"], ["propose_form"], ["read_policy"]]) expect(loopTurnCategory(tools, {})).not.toBe("unclassified");
  });
});
