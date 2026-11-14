import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormPatchCallInput, FormPatchCallResult } from "./form-patch-call";
import type { FormPatchInput } from "./form-patch-prompt";

/** STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (QA's live draft test, 8 Nov 2026): the account line is sent only with the flag on. */

const call = vi.hoisted(() => ({ inputs: [] as FormPatchCallInput[] }));

vi.mock("./form-patch-call", () => ({
  callFormPatchModel: vi.fn(async (input: FormPatchCallInput): Promise<FormPatchCallResult> => {
    call.inputs.push(input);
    return { fallback: "error" };
  }),
}));

import { FORM_PATCH_ACCOUNT_LINE, FORM_PATCH_READER_LINES, FORM_PATCH_SYSTEM_PROMPT } from "./form-patch-prompt";
import { readFormPatch } from "./form-patch-model";
import { SPELLING_CLEANUP_RULES } from "./spelling-cleanup";
import { spellingCleanupEnabled } from "@/lib/config/chat-quality-flags";

/**
 * Changed on purpose (SPELLING_CLEANUP_ENABLED, 13 Nov 2026): the system as sent; with that flag on, its cleanup rules
 * follow the approved text and the other lines (`form-patch-model.ts`).
 */
function withCleanupRules(text: string): string {
  return spellingCleanupEnabled() ? [text, ...SPELLING_CLEANUP_RULES].join("\n") : text;
}

const INPUT: FormPatchInput = {
  today: "2026-11-07",
  templateName: "Coaching Form",
  employeeName: "Ottoline Ormsworth",
  fields: [
    { key: "other_topic", label: "Other", kind: "text", filledBy: "assistant", value: "" },
    { key: "coaching_details", label: "Details of Coaching", kind: "long text", filledBy: "assistant", value: "Observed:\nOttoline missed the monthly meeting on 10/10/26." },
  ],
  readOnly: [],
  turns: [],
  latest: "I need you to make it about showing up late",
};

afterEach(() => {
  vi.unstubAllEnvs();
  call.inputs.length = 0;
});

describe("the account line", () => {
  it("is added after the approved text and the reader lines, with the flag on", async () => {
    vi.stubEnv("FORM_PATCH_REDUCER_ENABLED", "1");
    vi.stubEnv("FORM_PATCH_READER_FIXES_ENABLED", "1");
    vi.stubEnv("STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED", "1");
    await readFormPatch(INPUT);
    expect(call.inputs[0]!.system).toBe(withCleanupRules(`${FORM_PATCH_SYSTEM_PROMPT}\n${FORM_PATCH_READER_LINES}\n${FORM_PATCH_ACCOUNT_LINE}`));
  });

  it("is never sent with the flag off, or without the reader fixes", async () => {
    vi.stubEnv("FORM_PATCH_REDUCER_ENABLED", "1");
    vi.stubEnv("FORM_PATCH_READER_FIXES_ENABLED", "1");
    await readFormPatch(INPUT);
    expect(call.inputs[0]!.system).toBe(withCleanupRules(`${FORM_PATCH_SYSTEM_PROMPT}\n${FORM_PATCH_READER_LINES}`));
    vi.stubEnv("FORM_PATCH_READER_FIXES_ENABLED", "");
    vi.stubEnv("STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED", "1");
    await readFormPatch(INPUT);
    expect(call.inputs[1]!.system).toBe(withCleanupRules(FORM_PATCH_SYSTEM_PROMPT));
  });
});
