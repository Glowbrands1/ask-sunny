import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormPatchCallInput, FormPatchCallResult } from "./form-patch-call";
import type { FormPatchInput } from "./form-patch-prompt";

/** Step B: the model module parses the call's raw output; anything else is a fallback. The call is stubbed. */

const call = vi.hoisted(() => ({ result: null as FormPatchCallResult | null, inputs: [] as FormPatchCallInput[] }));

vi.mock("./form-patch-call", () => ({
  callFormPatchModel: vi.fn(async (input: FormPatchCallInput) => {
    call.inputs.push(input);
    return call.result;
  }),
}));

import { FORM_PATCH_SYSTEM_PROMPT } from "./form-patch-prompt";
import { readFormPatch } from "./form-patch-model";

const INPUT: FormPatchInput = {
  today: "2026-11-03",
  templateName: "Corrective Action",
  employeeName: "Rowan Tessaly",
  fields: [
    { key: "observation", label: "Observation", kind: "long text", filledBy: "manager", value: "Drawer short." },
    { key: "payroll_amount", label: "Amount", kind: "text", filledBy: "empty", value: "" },
  ],
  readOnly: [],
  turns: [],
  latest: "payroll deduct applies and $3.25 will be deducted from check.",
};

beforeEach(() => {
  call.result = null;
  call.inputs.length = 0;
});

describe("readFormPatch", () => {
  it("returns the turn and the patch from a valid output", async () => {
    call.result = {
      ok: true,
      output: { turn: "this_form", set: [{ field: "payroll_amount", value: "$3.25", how: "replace", evidence: "$3.25 will be deducted" }], clear: [] },
    };
    await expect(readFormPatch(INPUT)).resolves.toEqual({
      ok: true,
      turn: "this_form",
      patch: { set: { payroll_amount: "$3.25" }, clear: [], how: { payroll_amount: "replace" }, evidence: { payroll_amount: "$3.25 will be deducted" } },
    });
    expect(call.inputs[0]!.system).toBe(FORM_PATCH_SYSTEM_PROMPT);
    expect(call.inputs[0]!.prompt).toContain("LATEST MESSAGE FROM THE MANAGER: payroll deduct applies");
    expect(JSON.stringify(call.inputs[0]!.schema)).toContain('"payroll_amount"');
  });

  it("passes a timeout and an error through as fallbacks", async () => {
    call.result = { fallback: "timeout" };
    await expect(readFormPatch(INPUT)).resolves.toEqual({ fallback: "timeout" });
    call.result = { fallback: "error" };
    await expect(readFormPatch(INPUT)).resolves.toEqual({ fallback: "error" });
  });

  it("an output the schema refuses is an invalid fallback", async () => {
    call.result = { ok: true, output: { turn: "this_form", set: [{ field: "employee_name", value: "x", how: "replace", evidence: "x" }], clear: [] } };
    await expect(readFormPatch(INPUT)).resolves.toEqual({ fallback: "invalid" });
    call.result = { ok: true, output: { turn: "this_form", set: [], clear: [], reply: "Updated!" } };
    await expect(readFormPatch(INPUT)).resolves.toEqual({ fallback: "invalid" });
    call.result = { ok: true, output: "not an object" };
    await expect(readFormPatch(INPUT)).resolves.toEqual({ fallback: "invalid" });
  });

  it("a form with no settable fields makes no call", async () => {
    await expect(readFormPatch({ ...INPUT, fields: [] })).resolves.toEqual({ fallback: "no_fields" });
    expect(call.inputs).toHaveLength(0);
  });
});
