import { describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { NOTHING_CHANGED } from "./form-diff-reply";
import type { FormDraft } from "./form-reducer";
import { checkedClaim, type FormSnapshot } from "./form-snapshot";
import { PAYROLL_AMOUNT_QUESTION } from "./payroll-amount-field";

/*
 * FORM_REPLY_FROM_DIFF_ENABLED, as QA ruled on 3 Nov 2026: a path's reply is
 * kept word for word when its claim (`formUpdate`) is borne out by the saved
 * form; only a false claim is replaced; no claim, no change.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const LABELS = { payroll_deduct: "Is payroll deduct applicable?", observation: "Observation of Offense", action_plan: "Action Plan" };

function snapshot(values: Record<string, string | string[]>): FormSnapshot {
  const draft: Record<string, FormDraft[string]> = {};
  for (const [key, value] of Object.entries(values)) draft[key] = { key, value, owner: "assistant" };
  return { instanceId: ID, status: "draft", draft, labels: LABELS };
}

const BEFORE = snapshot({ payroll_deduct: [], observation: "Observed:\nShort $3.25.", action_plan: "Plan." });

/** What the correction path writes when payroll becomes Yes and no amount is stated. */
const PAYROLL_REPLY: AskResponse = {
  content: `Updated the **Corrective Action Form** for **Pat Rivera**: Is payroll deduct applicable? → Yes.\n\n${PAYROLL_AMOUNT_QUESTION}`,
  citations: [],
  coverage: "not_applicable", recommendedVideoIds: [],
  formUpdate: { instanceId: ID, updated: ["payroll_deduct"] },
};

describe("checkedClaim", () => {
  it("a confirmed claim keeps the path's reply byte for byte, the payroll amount question included", () => {
    const after = snapshot({ payroll_deduct: ["yes"], observation: "Observed:\nShort $3.25.", action_plan: "Plan." });
    const kept = checkedClaim(PAYROLL_REPLY, BEFORE, after);
    expect(kept).toBe(PAYROLL_REPLY);
    expect(kept.content).toContain(PAYROLL_AMOUNT_QUESTION);
  });

  it("a false claim with nothing changed is replaced by \"I didn't change anything\", and the claim is removed", () => {
    const replaced = checkedClaim(PAYROLL_REPLY, BEFORE, BEFORE);
    expect(replaced.content).toBe(NOTHING_CHANGED);
    expect(replaced.formUpdate).toBeUndefined();
  });

  it("a claim on a key that did not change, while another did, names only what really changed", () => {
    const after = snapshot({ payroll_deduct: [], observation: "Observed:\nShort $3.25.", action_plan: "Plan, rebuilt." });
    const replaced = checkedClaim(PAYROLL_REPLY, BEFORE, after);
    // Expectation changed on purpose (QA, 3 Nov 2026, Step B flip): the line says from what to what.
    expect(replaced.content).toBe('Changed Action Plan from "Plan." to "Plan, rebuilt.".');
    expect(replaced.formUpdate).toEqual({ instanceId: ID, updated: ["action_plan"] });
  });

  // Expectation changed on purpose (QA ruling on H1–H5, 3 Nov 2026): a claim is kept when ANY claimed key
  // changed, not only when every one did — a redraft claims every key it returns, so the old rule dropped
  // the guidance of a real change.
  it("a claim where any claimed key changed keeps the path's reply byte for byte, the payroll amount question included", () => {
    const partly: AskResponse = { ...PAYROLL_REPLY, formUpdate: { instanceId: ID, updated: ["payroll_deduct", "action_plan"] } };
    const after = snapshot({ payroll_deduct: ["yes"], observation: "Observed:\nShort $3.25.", action_plan: "Plan." });
    const kept = checkedClaim(partly, BEFORE, after);
    expect(kept).toBe(partly);
    expect(kept.content).toContain(PAYROLL_AMOUNT_QUESTION);
  });

  it("no claim: the reply is untouched, even though the saved form changed", () => {
    const plain: AskResponse = { content: "Tell me which part to change and what it should say.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
    const after = snapshot({ payroll_deduct: ["yes"], observation: "Observed:\nShort $3.25.", action_plan: "Plan." });
    expect(checkedClaim(plain, BEFORE, after)).toBe(plain);
  });

  it("a claim about another form is not judged against this one", () => {
    const other: AskResponse = { ...PAYROLL_REPLY, formUpdate: { instanceId: "22222222-2222-4222-8222-222222222222", updated: ["payroll_deduct"] } };
    expect(checkedClaim(other, BEFORE, BEFORE)).toBe(other);
  });
});

/* QA ruling on H1–H5 (3 Nov 2026): each required case, separately. */
function stamped(values: Record<string, string | string[]>, stamps: Record<string, string>): FormSnapshot {
  return { ...snapshot(values), stamps };
}

describe("checkedClaim, QA's H1–H5 cases", () => {
  const POLICY = "Standards of Conduct — JBA Policy Manual p.12";
  const GUIDANCE = "The policy line is still yours to confirm before you sign.";

  it("H1: a redraft that changes Observation but re-writes the same policy line keeps its guidance", () => {
    const before = stamped({ observation: "Old.", policy_language: POLICY }, { observation: "ai|draft", policy_language: "ai|manual" });
    const after = stamped({ observation: "New account.", policy_language: POLICY }, { observation: "ai|draft", policy_language: "ai|manual" });
    const redraft: AskResponse = {
      content: `Redrafted the form.\n\n${GUIDANCE}`,
      citations: [],
      coverage: "not_applicable", recommendedVideoIds: [],
      formUpdate: { instanceId: ID, updated: ["observation", "policy_language"] },
    };
    expect(checkedClaim(redraft, before, after)).toBe(redraft);
  });

  it('H1: "change the date to <the date it already has>" with nothing else changed is replaced', () => {
    const same = stamped({ form_date: "2026-10-20", observation: "Old." }, { form_date: "manager|", observation: "ai|draft" });
    const correction: AskResponse = { content: "Updated the Date to 10/20/2026.", citations: [], coverage: "not_applicable", recommendedVideoIds: [], formUpdate: { instanceId: ID, updated: ["form_date"] } };
    const replaced = checkedClaim(correction, same, same);
    expect(replaced.content).toBe(NOTHING_CHANGED);
    expect(replaced.formUpdate).toBeUndefined();
  });

  it("H2: a policy re-verification that only changes provenance keeps its reply", () => {
    const before = stamped({ policy_language: POLICY }, { policy_language: "ai|assistant" });
    const after = stamped({ policy_language: POLICY }, { policy_language: "ai|manual_verified" });
    const policyChange: AskResponse = { content: "The policy line is now checked against the manual.", citations: [], coverage: "not_applicable", recommendedVideoIds: [], formUpdate: { instanceId: ID, updated: ["policy_language"] } };
    expect(checkedClaim(policyChange, before, after)).toBe(policyChange);
  });

  it("H4: re-ticking the same options with nothing else changed is replaced", () => {
    const same = stamped({ payroll_deduct: ["yes"], observation: "Old." }, { payroll_deduct: "ai|draft", observation: "ai|draft" });
    const reticked: AskResponse = { content: "Updated Is payroll deduct applicable? → Yes.", citations: [], coverage: "not_applicable", recommendedVideoIds: [], formUpdate: { instanceId: ID, updated: ["payroll_deduct"] } };
    expect(checkedClaim(reticked, same, same).content).toBe(NOTHING_CHANGED);
  });

  it('a false "Updated" with nothing saved is still caught', () => {
    const replaced = checkedClaim(PAYROLL_REPLY, BEFORE, BEFORE);
    expect(replaced.content).toBe(NOTHING_CHANGED);
    expect(replaced.formUpdate).toBeUndefined();
  });

  it("H5: an empty claim counts as no claim — the reply is untouched", () => {
    const empty: AskResponse = { ...PAYROLL_REPLY, formUpdate: { instanceId: ID, updated: [] } };
    expect(checkedClaim(empty, BEFORE, BEFORE)).toBe(empty);
  });

  it("H3 (known limit): a claim on a key the form does not have is left untouched, never rewritten", () => {
    const odd: AskResponse = { ...PAYROLL_REPLY, formUpdate: { instanceId: ID, updated: ["not_a_form_row"] } };
    expect(checkedClaim(odd, BEFORE, BEFORE)).toBe(odd);
  });
});
