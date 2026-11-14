import { z } from "zod/v4";

import { editPolicyAskEnabled, formPatchReaderFixesEnabled, spellingCleanupEnabled, stepBMakeItAboutAccountEnabled } from "@/lib/config/chat-quality-flags";

import { callFormPatchModel } from "./form-patch-call";
import { buildFormPatchUserMessage, EDIT_POLICY_ASK_LINES, FORM_PATCH_ACCOUNT_LINE, FORM_PATCH_READER_LINES, FORM_PATCH_SYSTEM_PROMPT, type FormPatchInput } from "./form-patch-prompt";
import { patchOutputSchema, toPatch, type PatchOutput } from "./form-patch-schema";
import type { FormPatch } from "./form-reducer";
import { cleanupChanges, SPELLING_CLEANUP_RULES, withOwnWords } from "./spelling-cleanup";

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
  // SPELLING_CLEANUP_ENABLED (Pau via QA, 13 Nov 2026): the cleanup rule, after the approved text and the other added lines.
  const cleanup = spellingCleanupEnabled();
  const systemFor = (withCleanup: boolean) =>
    [
      FORM_PATCH_SYSTEM_PROMPT,
      ...(fixes ? [FORM_PATCH_READER_LINES] : []),
      ...(accountLine ? [FORM_PATCH_ACCOUNT_LINE] : []),
      ...(policyAsk ? [EDIT_POLICY_ASK_LINES] : []),
      ...(withCleanup ? SPELLING_CLEANUP_RULES : []),
    ].join("\n");
  const read = async (withCleanup: boolean): Promise<FormPatchReading> => {
    const called = await callFormPatchModel({
      system: systemFor(withCleanup),
      prompt: buildFormPatchUserMessage(input),
      schema: z.toJSONSchema(schema) as Record<string, unknown>,
    });
    if (!("ok" in called)) return { fallback: called.fallback };
    const parsed = schema.safeParse(called.output);
    if (!parsed.success) return { fallback: "invalid" };
    const asked = (parsed.data as { policy_asked?: boolean }).policy_asked;
    return { ok: true, turn: parsed.data.turn, patch: toPatch(parsed.data), ...(policyAsk && asked !== undefined ? { policyAsked: asked } : {}) };
  };
  const reading = await read(cleanup);
  if (!cleanup || !("ok" in reading)) return reading;
  // A cleanup never changes a name, date, number or quote; if one did, the patch is read again without the rule.
  const changes = patchCleanupChanges(input, reading.patch);
  if (changes.length === 0) return reading;
  console.warn(`[spelling-cleanup] the cleaned edit changed ${changes.join("; ")}; reading it with the manager's own text`);
  const again = await read(false);
  if (!("ok" in again)) return again;
  /*
   * QA's safety ruling (13 Nov 2026): the fallback is checked again. A field it would still write with a changed name,
   * date, number or quote is left out of the patch, so the form keeps the manager's own words there.
   */
  const recheck = withOwnWords(again.patch.set, { ...patchCleanupSource(input), own: () => null });
  if (recheck.replaced.length === 0) return again;
  console.warn(`[spelling-cleanup] the fallback edit still changed ${recheck.replaced.join(", ")}; keeping the form's own words there`);
  return { ...again, patch: { ...again.patch, set: recheck.values as typeof again.patch.set } };
}

/** What a patch was given: the manager's words, the form as it stands, the employee. */
function patchCleanupSource(input: FormPatchInput): { source: string; today: string; names: string[] } {
  const text = (value: unknown) => (typeof value === "string" ? value : Array.isArray(value) ? value.join("\n") : "");
  return {
    source: [
      // Everything the patch reader was given (its whole message), and the manager's words and the form as read.
      buildFormPatchUserMessage(input),
      ...input.turns.filter((turn) => turn.role === "manager").map((turn) => turn.content),
      input.latest,
      ...input.fields.map((field) => text(field.value)),
      ...input.readOnly.map((field) => text(field.value)),
    ].join("\n"),
    today: input.today,
    names: input.employeeName ? [input.employeeName] : [],
  };
}

/** SPELLING_CLEANUP_ENABLED: what a patch's text changes of the names, dates, numbers and quotes it was given. */
export function patchCleanupChanges(input: FormPatchInput, patch: FormPatch): string[] {
  const text = (value: unknown) => (typeof value === "string" ? value : Array.isArray(value) ? value.join("\n") : "");
  return cleanupChanges({ ...patchCleanupSource(input), written: Object.values(patch.set).map(text).join("\n") });
}
