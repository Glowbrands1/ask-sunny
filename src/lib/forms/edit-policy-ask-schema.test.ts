import { afterEach, describe, expect, it, vi } from "vitest";

import { EDIT_POLICY_ASK_LINES, FORM_PATCH_SYSTEM_PROMPT, type FormPatchInput } from "./form-patch-prompt";
import { patchOutputSchema } from "./form-patch-schema";

/**
 * EDIT_POLICY_ASK_ENABLED (QA's live run, 7 Nov 2026: "… and please list the policy …" on an open Coaching Form
 * was ignored): the patch reader's `policy_asked` key and its prompt line. Off, the schema and the prompt are as
 * before.
 */

const KEYS = ["coaching_details", "form_date"] as const;
const OUTPUT = { turn: "this_form", set: [{ field: "coaching_details", value: "Thaddeus showed up late.", how: "replace", evidence: "make it about showing up late" }], clear: [] };

vi.mock("./form-patch-call", () => ({ callFormPatchModel: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("patchOutputSchema policy_asked", () => {
  it("off: no such key; an output that has one is refused (strict), as before", () => {
    const schema = patchOutputSchema([...KEYS]);
    expect(schema.safeParse(OUTPUT).success).toBe(true);
    expect(schema.safeParse({ ...OUTPUT, policy_asked: true }).success).toBe(false);
  });

  it("on: policy_asked is read, and may be left out", () => {
    const schema = patchOutputSchema([...KEYS], { policyAsked: true });
    expect(schema.safeParse({ ...OUTPUT, policy_asked: true }).success).toBe(true);
    expect(schema.safeParse({ ...OUTPUT, policy_asked: false }).success).toBe(true);
    expect(schema.safeParse(OUTPUT).success).toBe(true);
    expect(schema.safeParse({ ...OUTPUT, policy_asked: "yes" }).success).toBe(false);
  });
});

describe("readFormPatch with EDIT_POLICY_ASK_ENABLED", () => {
  const input: FormPatchInput = { today: "2026-11-07", templateName: "Coaching Form", employeeName: "Thaddeus Lowestoft", fields: [{ key: "coaching_details", label: "Details of Coaching", kind: "text", filledBy: "assistant", value: "" }], readOnly: [], turns: [], latest: "I need you to make it about showing up late and please list the policy make the date for 10/14/26." };

  it("off: the approved prompt alone, and no policyAsked on the reading", async () => {
    const { callFormPatchModel } = await import("./form-patch-call");
    vi.mocked(callFormPatchModel).mockResolvedValue({ ok: true, output: OUTPUT });
    const { readFormPatch } = await import("./form-patch-model");
    const reading = await readFormPatch(input);
    expect(vi.mocked(callFormPatchModel).mock.calls[0]![0].system).toBe(FORM_PATCH_SYSTEM_PROMPT);
    expect(reading).not.toHaveProperty("policyAsked");
  });

  it("on (with Step B): the line is added after the approved text, and the reading carries policyAsked", async () => {
    vi.stubEnv("FORM_PATCH_REDUCER_ENABLED", "true");
    vi.stubEnv("EDIT_POLICY_ASK_ENABLED", "true");
    const { callFormPatchModel } = await import("./form-patch-call");
    vi.mocked(callFormPatchModel).mockResolvedValue({ ok: true, output: { ...OUTPUT, policy_asked: true } });
    const { readFormPatch } = await import("./form-patch-model");
    const reading = await readFormPatch(input);
    const system = vi.mocked(callFormPatchModel).mock.calls[0]![0].system;
    expect(system.startsWith(FORM_PATCH_SYSTEM_PROMPT)).toBe(true);
    expect(system.endsWith(EDIT_POLICY_ASK_LINES)).toBe(true);
    expect(reading).toMatchObject({ ok: true, policyAsked: true });
  });

  it("the flag alone, without Step B, is off", async () => {
    vi.stubEnv("EDIT_POLICY_ASK_ENABLED", "true");
    const { editPolicyAskEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(editPolicyAskEnabled()).toBe(false);
  });
});
