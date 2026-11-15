import { describe, expect, it } from "vitest";

import { ACCOUNT_LABELS, ACTION_PLAN_LABELS, dictatedField, dictatedText } from "./dictated";

/* Batch J2 (QA's live re-run, L4 t3): a field the manager dictates is saved word for word; names invented. */
const SAID = "Juno completed onboarding with new hire Corran Vale on 9-28-26. As of 10-16-26 Corran had not acknowledged onboarding policies in Woven that should have been completed during onboarding.";
const L4_T3 = `change observation of offense to: ${SAID}`;

describe("a dictated field", () => {
  it("L4 t3: the model's text verbatim after \"change observation of offense to:\" is the manager's own, as typed", () => {
    expect(dictatedField(L4_T3, ACCOUNT_LABELS, SAID.toLowerCase())).toBe(SAID);
    expect(dictatedText(L4_T3, ACCOUNT_LABELS)).toBe(SAID);
  });

  it("a reword is not dictation (the live model's passive version)", () => {
    const reworded = "On 9-28-26, onboarding was completed with new hire Corran Vale. As of 10-16-26, Corran had not acknowledged onboarding policies in Woven.";
    expect(dictatedField(L4_T3, ACCOUNT_LABELS, reworded)).toBeNull();
  });

  it("both markers: \"<label>: …\" and \"change / set / update the <label> to …\"", () => {
    expect(dictatedField(`Observation of Offense: ${SAID}`, ACCOUNT_LABELS, SAID)).toBe(SAID);
    expect(dictatedField(`update the observation to ${SAID}`, ACCOUNT_LABELS, SAID)).toBe(SAID);
  });

  it("no marker, no dictation: a field named in passing, or another field's marker", () => {
    expect(dictatedText(`leave the observation alone, ${SAID}`, ACCOUNT_LABELS)).toBeNull();
    expect(dictatedField(`Action Plan: ${SAID}`, ACCOUNT_LABELS, SAID)).toBeNull();
    expect(dictatedField(`Action Plan: ${SAID}`, ACTION_PLAN_LABELS, SAID)).toBe(SAID);
  });

  it("ten characters or fewer is never dictation", () => {
    expect(dictatedField("observation: she was late", ACCOUNT_LABELS, "was late")).toBeNull();
  });

  it("\"change the observation to say …\" is an instruction, not the words", () => {
    expect(dictatedText("change the observation to say it was a jacket", ACCOUNT_LABELS)).toBeNull();
    expect(dictatedText(`change the observation to ${SAID}`, ACCOUNT_LABELS)).toBe(SAID);
  });

  it("a pasted form is an outline, not one field's words", async () => {
    const { pastedOutline } = await import("./dictated");
    expect(pastedOutline(`Observation of Offense: ${SAID}\n\nAction Plan: The Leadership Team will coach Juno.`)).toBe(true);
    expect(pastedOutline("make it in the format of Corran's ca")).toBe(true);
    expect(pastedOutline(`Observation of Offense: ${SAID}\nIt needs to look like this format but for juno paxton:`)).toBe(true);
    expect(pastedOutline(L4_T3)).toBe(false);
  });
});
