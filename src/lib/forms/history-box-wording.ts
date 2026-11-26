import type { FormBlock, FormDocument, FormField } from "./document";
import { PRIOR_ACTIONS_HELP } from "./required-fields";

/**
 * ============================================================================
 * THE HISTORY BOX AS IT IS WORDED NOW, ON EVERY STORED VERSION
 * ============================================================================
 *
 * Pau, 26 Nov 2026: "just remove the 90 day wording". The Corrective Action's history box was published (revision 9)
 * as "List previous coaching and corrective actions and include date signed by employee in past 90 days", with help
 * telling the manager to write "None — first occurrence". Neither is true any more: the list holds every coaching and
 * corrective action on file (and those waiting for HR or sent back), and the app writes "N/A" when there are none.
 *
 * A published version cannot be edited, and a new revision would leave every open draft on the old words, so a stored
 * version is READ with the current wording (`repository.ts` mapVersion): the label loses " in past 90 days" and the
 * help is the current one. Only those exact published words are replaced; a label or help an administrator wrote is
 * kept. Nothing stored changes. Pure and browser-safe.
 */
const OLD_LABEL_TAIL = / in past 90 days$/;
const OLD_HELP = 'Write "None — first occurrence" when there has been none';

function current(field: FormField): FormField {
  if (field.key !== "prior_actions") return field;
  const label = field.label.replace(OLD_LABEL_TAIL, "");
  const help = field.help?.includes(OLD_HELP) ? PRIOR_ACTIONS_HELP : field.help;
  if (label === field.label && help === field.help) return field;
  return { ...field, label, ...(help !== undefined ? { help } : {}) };
}

export function currentHistoryWording(document: FormDocument): FormDocument {
  let changed = false;
  const blocks = document.blocks.map((block): FormBlock => {
    if (block.kind === "field") {
      const field = current(block.field);
      if (field === block.field) return block;
      changed = true;
      return { ...block, field };
    }
    if (block.kind === "field_row") {
      const fields = block.fields.map(current);
      if (fields.every((field, index) => field === block.fields[index])) return block;
      changed = true;
      return { ...block, fields };
    }
    return block;
  });
  return changed ? { ...document, blocks } : document;
}
