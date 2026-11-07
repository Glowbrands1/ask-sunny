import { z } from "zod/v4";

import type { FieldValue, FormPatch } from "./form-reducer";

/**
 * What the form-patch model returns (FORM_PATCH_REDUCER_ENABLED), its field
 * enum built per template from the keys the reducer may write. Strict: an
 * extra key anywhere is a failed parse, and the turn falls back to the old
 * path. See `form-patch-model.ts`.
 */
export function patchOutputSchema(keys: readonly [string, ...string[]], options: { reword?: boolean } = {}) {
  // FORM_PATCH_READER_FIXES_ENABLED: "reword" is one more `how`. Off, the schema is as before.
  const how = options.reword ? z.enum(["add", "replace", "reword"]) : z.enum(["add", "replace"]);
  return z
    .object({
      turn: z.enum(["this_form", "question", "other"]),
      set: z
        .array(
          z
            .object({
              field: z.enum(keys),
              value: z.string().max(4000).optional(),
              options: z.array(z.string()).max(10).optional(),
              how,
              evidence: z.string().min(1).max(1500),
            })
            .strict(),
        )
        .max(20),
      clear: z.array(z.object({ field: z.enum(keys), evidence: z.string().min(1).max(500) }).strict()).max(10),
    })
    .strict();
}

export type PatchOutput = z.infer<ReturnType<typeof patchOutputSchema>>;

/**
 * The model's output as a reducer patch. `options` are a checkbox field's
 * value, `value` a text field's. A field set twice keeps its last entry.
 */
export function toPatch(output: PatchOutput): FormPatch {
  const set: Record<string, FieldValue> = {};
  const how: Record<string, "add" | "replace" | "reword"> = {};
  const evidence: Record<string, string> = {};
  for (const entry of output.set) {
    set[entry.field] = entry.options !== undefined ? [...entry.options] : (entry.value ?? "");
    how[entry.field] = entry.how;
    evidence[entry.field] = entry.evidence;
  }
  const clear: string[] = [];
  for (const entry of output.clear) {
    if (!clear.includes(entry.field)) clear.push(entry.field);
    evidence[entry.field] ??= entry.evidence;
  }
  return { set, clear, how, evidence };
}
