import { z } from "zod/v4";

import { formPatchReaderFixesEnabled, stepBMakeItAboutAccountEnabled } from "@/lib/config/chat-quality-flags";

import { callFormPatchModel } from "./form-patch-call";
import { buildFormPatchUserMessage, FORM_PATCH_ACCOUNT_LINE, FORM_PATCH_READER_LINES, FORM_PATCH_SYSTEM_PROMPT, type FormPatchInput } from "./form-patch-prompt";
import { patchOutputSchema, toPatch, type PatchOutput } from "./form-patch-schema";
import type { FormPatch } from "./form-reducer";

/**
 * The open form's patch from the manager's latest message
 * (FORM_PATCH_REDUCER_ENABLED). The model's raw object is parsed here with
 * the template's schema; a timeout, an error, or an object the schema
 * refuses is a fallback, and the whole turn runs on the old path. Nothing
 * here writes: the reducer decides what reaches the form.
 */

export type FormPatchReading =
  | { readonly ok: true; readonly turn: PatchOutput["turn"]; readonly patch: FormPatch }
  | { readonly fallback: "timeout" | "error" | "invalid" | "no_fields" };

export async function readFormPatch(input: FormPatchInput): Promise<FormPatchReading> {
  const keys = input.fields.map((field) => field.key);
  if (keys.length === 0) return { fallback: "no_fields" };
  // FORM_PATCH_READER_FIXES_ENABLED: "reword", and its prompt lines added after the approved text.
  const fixes = formPatchReaderFixesEnabled();
  const schema = fixes ? patchOutputSchema(keys as [string, ...string[]], { reword: true }) : patchOutputSchema(keys as [string, ...string[]]);
  const called = await callFormPatchModel({
    // STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED: one more line after the reader lines (`form-patch-prompt.ts`).
    system: fixes
      ? `${FORM_PATCH_SYSTEM_PROMPT}\n${FORM_PATCH_READER_LINES}${stepBMakeItAboutAccountEnabled() ? `\n${FORM_PATCH_ACCOUNT_LINE}` : ""}`
      : FORM_PATCH_SYSTEM_PROMPT,
    prompt: buildFormPatchUserMessage(input),
    schema: z.toJSONSchema(schema) as Record<string, unknown>,
  });
  if (!("ok" in called)) return { fallback: called.fallback };
  const parsed = schema.safeParse(called.output);
  if (!parsed.success) return { fallback: "invalid" };
  return { ok: true, turn: parsed.data.turn, patch: toPatch(parsed.data) };
}
