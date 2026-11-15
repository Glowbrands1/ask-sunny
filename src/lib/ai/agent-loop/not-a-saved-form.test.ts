import { describe, expect, it } from "vitest";

import { editForm, type ToolContext, type ToolEffects } from "./tools";

/*
 * PR 4 (QA's review of #1022): an id that is no saved form's is not_a_form_id and never points at propose_form. (The "card on
 * screen" text, for a shown card Create has not recorded, is tested in created-from-proposal.test.ts with the lookup mocked.)
 */
const PROPOSAL_ID = "7f1d6d3a-5c0b-4f3e-9b8e-2a6c1f4d9e01";
const context = { actor: { subject: "u-1", email: "m@example.com", displayName: "Manager", role: "salon_director", scope: { level: "salon", locationIds: [] }, verified: true }, question: "make it a verbal", history: [], openFormId: null } as unknown as ToolContext;

describe("edit_form on the id of a card that is not created yet", () => {
  it("an id that is no card's and no uuid never points at propose_form (not_a_form_id)", async () => {
    const result = await editForm(context, { proposal: null, formUpdate: null } as unknown as ToolEffects, { instance_id: "juno-ca", values: { warning_type: "verbal" } });
    expect(result.reason_code).toBe("not_a_form_id");
    expect(String(result.error)).not.toMatch(/propose_form/);
  });
});
