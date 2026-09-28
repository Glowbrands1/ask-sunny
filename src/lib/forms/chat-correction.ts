import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  parseFormDocument,
  type FormDocument,
} from "./document";
import { CORRECTABLE_KEYS, correctionValues, employmentChangeKind } from "./employment-change";
import { authorizeInstance } from "./instance-scope";
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
  const correction = correctionValues(input.question, input.today);
  if (!correction) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    // Not visible, not permitted, or gone: the turn goes on as a normal one.
    return null;
  }
  const { actor, loaded } = authorized;
  if (!employmentChangeKind(loaded.instance.templateKey)) return null;

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
  const lines = [
    `Updated the ${who}: ${updated.map((key) => describe(document, variantKey, key, submitted)).join("; ")}.`,
  ];
  if ((reason?.value ?? "").trim() !== "") {
    lines.push("", "The reason paragraph was written before this change — give it a quick read to make sure it still matches.");
  }

  return { ...reply(lines.join("\n")), formUpdate: { instanceId: input.instanceId, updated } };
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
  return `${group?.label ?? key} → ${options}`;
}
