import { z } from "zod/v4";

import { editPolicyAskEnabled, formPatchReaderFixesEnabled, stepBMakeItAboutAccountEnabled } from "@/lib/config/chat-quality-flags";

import { callFormPatchModel } from "./form-patch-call";
import { buildFormPatchUserMessage, EDIT_POLICY_ASK_LINES, FORM_PATCH_ACCOUNT_LINE, FORM_PATCH_READER_LINES, FORM_PATCH_SYSTEM_PROMPT, type FormPatchInput } from "./form-patch-prompt";
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
  | {
      readonly ok: true;
      readonly turn: PatchOutput["turn"];
      readonly patch: FormPatch;
      /** EDIT_POLICY_ASK_ENABLED: the latest message asks for the policy. Unset with the flag off. */
      readonly policyAsked?: boolean;
    }
  | { readonly fallback: "timeout" | "error" | "invalid" | "no_fields" };

export async function readFormPatch(input: FormPatchInput): Promise<FormPatchReading> {
  const keys = input.fields.map((field) => field.key);
  if (keys.length === 0) return { fallback: "no_fields" };
  // FORM_PATCH_READER_FIXES_ENABLED: "reword", and its prompt lines added after the approved text.
  const fixes = formPatchReaderFixesEnabled();
  // EDIT_POLICY_ASK_ENABLED: the `policy_asked` key, and its line added after the approved text (and the fix lines).
  const policyAsk = editPolicyAskEnabled();
  const schema =
    fixes || policyAsk
      ? patchOutputSchema(keys as [string, ...string[]], { ...(fixes ? { reword: true } : {}), ...(policyAsk ? { policyAsked: true } : {}) })
      : patchOutputSchema(keys as [string, ...string[]]);
  // STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED: one more line after the reader lines (`form-patch-prompt.ts`).
  const accountLine = fixes && stepBMakeItAboutAccountEnabled();
  const system = [
    FORM_PATCH_SYSTEM_PROMPT,
    ...(fixes ? [FORM_PATCH_READER_LINES] : []),
    ...(accountLine ? [FORM_PATCH_ACCOUNT_LINE] : []),
    ...(policyAsk ? [EDIT_POLICY_ASK_LINES] : []),
  ].join("\n");
  const called = await callFormPatchModel({
    system,
    prompt: buildFormPatchUserMessage(input),
    schema: z.toJSONSchema(schema) as Record<string, unknown>,
  });
  if (!("ok" in called)) return { fallback: called.fallback };
  const parsed = schema.safeParse(called.output);
  if (!parsed.success) return { fallback: "invalid" };
  const asked = (parsed.data as { policy_asked?: boolean }).policy_asked;
  return { ok: true, turn: parsed.data.turn, patch: toPatch(parsed.data), ...(policyAsk && asked !== undefined ? { policyAsked: asked } : {}) };
}
