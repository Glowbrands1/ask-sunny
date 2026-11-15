import { describe, expect, it } from "vitest";

import { editForm, type ToolContext, type ToolEffects } from "./tools";

/*
 * PR 4 (QA's review of #1022): the "card on screen" text is for a card shown this turn that Create has not recorded, and
 * only for that. (Another id that is no saved form's is not_a_form_id: replay case nov15-agent-loop-pr4-not-a-form-id.)
 */
const PROPOSAL_ID = "7f1d6d3a-5c0b-4f3e-9b8e-2a6c1f4d9e01";
const context = { actor: { subject: "u-1", email: "m@example.com", displayName: "Manager", role: "salon_director", scope: { level: "salon", locationIds: [] }, verified: true }, question: "make it a verbal", history: [], openFormId: null } as unknown as ToolContext;

describe("edit_form on the id of a card that is not created yet", () => {
  it("says it is the card on screen and to change it with propose_form (not_a_saved_form)", async () => {
    const effects = { proposal: { proposalId: PROPOSAL_ID, templateKey: "dpoa", employeeName: "Remy Calder" }, formUpdate: null } as unknown as ToolEffects;
    const result = await editForm(context, effects, { instance_id: PROPOSAL_ID, values: { warning_type: "verbal" } });
    expect(result.reason_code).toBe("not_a_saved_form");
    expect(String(result.error)).toBe("That's the card on screen; it isn't created yet. Change it with propose_form.");
  });
  it("an id that is no card's and no uuid never points at propose_form (not_a_form_id)", async () => {
    const result = await editForm(context, { proposal: null, formUpdate: null } as unknown as ToolEffects, { instance_id: "juno-ca", values: { warning_type: "verbal" } });
    expect(result.reason_code).toBe("not_a_form_id");
    expect(String(result.error)).not.toMatch(/propose_form/);
  });
});
