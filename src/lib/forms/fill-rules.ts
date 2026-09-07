import type { TemplateField } from "@/types";
import type { FormDraftRequest, FormDraftResponse } from "@/lib/ai/types";

/**
 * ============================================================================
 * WHAT SURVIVED `chat-flow.ts`
 * ============================================================================
 *
 * `lib/forms/chat-flow.ts` held two unrelated things under one name: the
 * prototype's chat-to-form script, and the structural guard that decides which
 * fields a model may write. Phase 2 deleted the first and kept the second, so
 * the file is named for what it actually is.
 *
 * WHAT WENT, AND WHY IT COULD NOT STAY FOR COMPATIBILITY:
 *
 *   isFormIntent / detectTemplate     resolved any unrecognised form request to
 *                                     the Coaching Form
 *   extractEmployeeName               accepted a capitalised first word, so
 *                                     "Create a coaching form..." produced an
 *                                     employee named "Create"
 *   findPendingFormTurn               read half-filled HR values back out of a
 *                                     browser-local assistant turn
 *   buildFormCollection               suggested "Jane Kowalski — late on the
 *                                     12th, 15th and 19th" as a follow-up chip
 *   buildFormDraft                    defaulted the employee, the topic, the
 *                                     incident details, the job title, the
 *                                     expected action and the follow-up date
 *   publishedTemplateKeyFor           mapped this module's invented `tpl-*` ids
 *                                     onto the published library
 *
 * Every one of those wrote a plausible value where a fact was missing. Chat now
 * proposes rather than drafts — see `lib/forms/proposal.ts` — and a missing
 * fact is reported as missing.
 *
 * ============================================================================
 * THE GUARD THAT SURVIVES EVERY PROVIDER
 * ============================================================================
 *
 * `applyFillRules` runs on MODEL OUTPUT, not before it. Only fields the
 * template marks `ai_populate` may be written, and a signature field is
 * excluded structurally regardless of how it is marked. Whatever a model
 * returns, a signature line stays blank.
 */

/* --------------------------------------------------- checkbox suggestions -- */

const COACHING_TOPIC_MAP: { keywords: string[]; option: string }[] = [
  { keywords: ["tardy", "tardiness", "late", "attendance", "punctual", "call out", "no show"], option: "Attendance / punctuality" },
  { keywords: ["dress", "uniform", "badge", "footwear", "grooming"], option: "Dress code" },
  { keywords: ["sales", "conversion", "membership", "upgrade", "quota"], option: "Sales performance" },
  { keywords: ["guest", "client", "customer", "greeting", "service"], option: "Client experience" },
  { keywords: ["clean", "cleanliness", "turnover", "sanit"], option: "Cleanliness standards" },
  { keywords: ["policy", "procedure", "checklist", "closing", "opening"], option: "Policy adherence" },
  { keywords: ["team", "communication", "attitude", "conflict"], option: "Teamwork / communication" },
];

/**
 * Suggests a coaching topic from the topic THE MANAGER TYPED into the Create a
 * Form workspace. It is applied only where the template publishes a matching
 * option, and it never runs on an empty topic — see `fillCheckboxDefaults`.
 */
export function coachingTopicOption(topic: string): string {
  const t = topic.toLowerCase().trim();
  const match = COACHING_TOPIC_MAP.find((entry) =>
    entry.keywords.some((keyword) => t.includes(keyword)),
  );
  return match?.option ?? "Policy adherence";
}

/* -------------------------------------------------- template field guard -- */

export function applyFillRules(
  fields: TemplateField[],
  drafted: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  fields.forEach((field) => {
    if (field.fillRule !== "ai_populate") return;
    if (field.type === "signature") return;
    const value = drafted[field.id];
    if (typeof value === "string" && value.length > 0) values[field.id] = value;
  });
  return values;
}

/** Field ids a model is allowed to fill for a given template. */
export function writableFieldIds(fields: TemplateField[]): string[] {
  return fields
    .filter((field) => field.fillRule === "ai_populate" && field.type !== "signature")
    .map((field) => field.id);
}

/** Deterministic checkbox defaults, applied after any model output. */
export function fillCheckboxDefaults(
  request: FormDraftRequest,
  selections: Record<string, string[]>,
  topic: string,
): Record<string, string[]> {
  const checkedOptions: Record<string, string[]> = { ...selections };
  request.fields
    .filter((field) => field.type === "checkbox_group" && field.fillRule === "ai_populate")
    .forEach((field) => {
      if (checkedOptions[field.id]?.length) return;
      if (field.id === "coaching_topic" && field.options) {
        const suggestion = coachingTopicOption(topic);
        if (field.options.includes(suggestion)) checkedOptions[field.id] = [suggestion];
      }
      if (field.id === "coaching_type" && field.options) {
        checkedOptions[field.id] = [field.options[1] ?? field.options[0]!];
      }
    });
  return checkedOptions;
}

export type { FormDraftRequest, FormDraftResponse };
