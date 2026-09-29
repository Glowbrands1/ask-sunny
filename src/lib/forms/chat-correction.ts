import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  parseFormDocument,
  type FormDocument,
} from "./document";
import { CORRECTABLE_KEYS, correctionValues, employmentChangeKind, syncNarrative } from "./employment-change";
import { authorizeInstance } from "./instance-scope";
import { extractEmployeeNames } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { saveInstanceValues } from "./instances";

/**
 * ============================================================================
 * CORRECTING A FORM THAT ALREADY EXISTS, FROM THE CONVERSATION
 * ============================================================================
 *
 * "Change her new location to salon 24", typed after the Demotion or Position
 * Transfer Form was created in this conversation, updates that form rather
 * than starting the interview again.
 *
 * EVERYTHING IS RE-CHECKED. The browser names the instance; this loads it and
 * runs `authorizeInstance` with the "edit" action, which applies the TEMPLATE'S
 * own permission and the salon scope exactly as the inline editor's save does.
 * An id that fails, or that is not an employment change form, returns null and
 * the turn is answered as it always would have been.
 *
 * IT IS THE MANAGER'S OWN EDIT. Saved through `saveInstanceValues` — the same
 * path as typing into the field — so it is recorded as the manager's, refused
 * on a finalized form, and limited to fields a person may edit.
 */
export async function correctActiveForm(input: {
  request: Request;
  instanceId: string;
  question: string;
  today: string;
}): Promise<AskResponse | null> {
  // A cheap first reading, before anything is loaded: most turns are not corrections.
  if (!correctionValues(input.question, input.today)) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    // Not visible, not permitted, or gone: the turn goes on as a normal one.
    return null;
  }
  const { actor, loaded } = authorized;
  const kind = employmentChangeKind(loaded.instance.templateKey);
  if (!kind) return null;
  /*
   * ==========================================================================
   * A NEW REQUEST IS NEVER A CORRECTION TO THE LAST FORM
   * ==========================================================================
   *
   * Found in hands-on QA: with a Demotion Form for one employee open, "pull
   * up a transfer form for jane doe, … from stc 12 to salon 18" was read as a
   * correction and wrote Jane's details onto the other employee's demotion.
   * So a turn that asks for a form (any other than this one), or that names a
   * person who is not this form's employee, is left to the ordinary flow —
   * which proposes the new form.
   */
  const intent = detectTemplateIntent(input.question);
  if (
    intent.kind === "ambiguous" ||
    intent.kind === "corrective_action" ||
    (intent.kind === "explicit" && intent.templateKey !== loaded.instance.templateKey) ||
    (intent.kind === "explicit" && /\b(?:create|make|start|pull up|new|another|need)\b/i.test(input.question))
  ) {
    return null;
  }
  // "change the name to …" is the one correction that names somebody new, on purpose.
  const renaming = /\b(?:change|update|correct|fix|set|make)\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:employee(?:'s)?\s+)?name\b/i.test(input.question);
  const named = renaming ? [] : extractEmployeeNames(input.question);
  if (named.length > 0 && !named.some((name) => samePerson(name, loaded.instance.employeeName))) {
    return null;
  }

  const correction = correctionValues(input.question, input.today);
  if (!correction) return null;

  const who = `**${loaded.instance.templateName}** for **${loaded.instance.employeeName}**`;
  if (loaded.instance.status !== "draft") {
    return reply(
      `The ${who} is finalized, so I haven't changed it. Open it from Form Monitoring and create a revision to make a change.`,
    );
  }

  const document = parseFormDocument(loaded.version.document);
  const variantKey = loaded.instance.variantKey;
  const restrict = <T,>(entries: Record<string, T>) =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => CORRECTABLE_KEYS.has(key)));
  const values = restrict(correction.values);
  const checked = restrict(correction.checked);

  // Only keys this version actually has; the rest are not a correction to THIS form.
  const present = new Set([
    ...fieldsForVariant(document, variantKey).map((field) => field.key),
    ...checkboxGroupsForVariant(document, variantKey).map((group) => group.key),
  ]);
  const onForm = <T,>(entries: Record<string, T>) =>
    Object.fromEntries(Object.entries(entries).filter(([key]) => present.has(key)));
  const submitted = { values: onForm(values), checked: onForm(checked) };
  const keys = [...Object.keys(submitted.values), ...Object.keys(submitted.checked)];
  if (keys.length === 0) return null;

  const { rejected } = await saveInstanceValues(input.instanceId, submitted, actor.id);
  const refused = new Set(rejected.map((entry) => entry.key));
  const updated = keys.filter((key) => !refused.has(key));
  if (updated.length === 0) return null;

  const reason = loaded.values.find((row) => row.fieldKey === "reason" || row.fieldKey === "details");
  const paragraph = reason?.fieldKey === "details" ? "Details paragraph" : "reason paragraph";
  const lines = [
    `Updated the ${who}: ${updated.map((key) => describe(document, variantKey, key, submitted)).join("; ")}.`,
  ];

  /*
   * THE PARAGRAPH FOLLOWS THE FIELD. A value the correction replaced is also
   * replaced where the reason paragraph names it, so the form never says
   * "Salon 24" in one place and "salon 23" in another. See `syncNarrative`.
   */
  const narrative = reason?.value ?? "";
  if (reason && narrative.trim() !== "") {
    const before = new Map(loaded.values.map((row) => [row.fieldKey, row.value ?? ""]));
    const changedText = updated.filter((key) => key in submitted.values);
    const sync = syncNarrative({
      narrative,
      changes: changedText.map((key) => ({ from: before.get(key) ?? "", to: submitted.values[key]! })),
      unchanged: loaded.values
        .filter((row) => row.fieldKey !== reason.fieldKey && !changedText.includes(row.fieldKey))
        .map((row) => row.value ?? "")
        .filter((value) => value.trim() !== ""),
    });
    let rewritten = false;
    if (sync.text !== narrative) {
      const saved = await saveInstanceValues(input.instanceId, { values: { [reason.fieldKey]: sync.text }, checked: {} }, actor.id);
      rewritten = saved.rejected.length === 0;
    }
    if (rewritten) {
      updated.push(reason.fieldKey);
      const changes = sync.replaced.map((change) => `"${change.from}" → "${change.to}"`).join(", ");
      lines.push("", `I changed ${changes} in the ${paragraph} too, so it matches the form.`);
    }
    if (sync.left.length > 0) {
      const values = sync.left.map((value) => `"${value}"`).join(", ");
      lines.push(
        "",
        `The ${paragraph} still mentions ${values}, which is also another line on this form, so I didn't change it there — check that it still says what you mean.`,
      );
    } else if (!rewritten) {
      lines.push("", `The ${paragraph} was written before this change — give it a quick read to make sure it still matches.`);
    }
  }

  return { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated } };
}

/** "jane", "Jane Doe" and "JANE DOE" name the employee on a form for "Jane Doe". */
function samePerson(named: string, employee: string): boolean {
  const a = named.toLowerCase().replace(/['’]s$/, "").split(/\s+/);
  const b = employee.toLowerCase().split(/\s+/);
  return a.join(" ") === b.join(" ") || (a.length === 1 && a[0] === b[0]);
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

/** "New Location → Salon 24", "Type of Demotion → Voluntary", in the form's own labels. */
function describe(
  document: FormDocument,
  variantKey: string | null,
  key: string,
  submitted: { values: Record<string, string>; checked: Record<string, string[]> },
): string {
  const field = fieldsForVariant(document, variantKey).find((entry) => entry.key === key);
  if (field) return `${field.label} → ${submitted.values[key]}`;
  const group = checkboxGroupsForVariant(document, variantKey).find((entry) => entry.key === key);
  const options = (submitted.checked[key] ?? [])
    .map((option) => group?.options.find((entry) => entry.key === option)?.label ?? option)
    .join(", ");
  // The separation boxes have no question of their own; the ticked box says it all.
  return group?.label ? `${group.label} → ${options}` : `Ticked ${options}`;
}
