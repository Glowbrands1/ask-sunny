/*
 * ============================================================================
 * ONE NOTICE FOR A DRAFT THAT SAVED NO ACCOUNT (ONE_DRAFT_NOTICE_ENABLED; QA, 11 Nov 2026; ported from the sibling app)
 * ============================================================================
 *
 * With DRAFT_WRITE_NEVER_SILENT and DRAFT_WROTE_NOTHING_NOTICE both on, a refused write with no account in the notes
 * showed two notices and two "fill it in below" offers. The first said "Nothing was saved on this draft", though the
 * form's Name, Date, Job Title and Location were saved: only the drafted fields were not. With this flag on, those two
 * become one: which field was not saved, by its label, then "what happened?" asked once. Pure.
 */

const list = (labels: readonly string[]): string => {
  const bold = [...new Set(labels.filter(Boolean))].map((label) => `**${label}**`);
  if (bold.length <= 1) return bold[0] ?? "";
  return `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
};

/**
 * The one notice: the fields the draft did not save (refused first, else the blank narrative fields), then the one
 * question. Null when there is no field to name.
 */
export function oneDraftNotice(input: { readonly notSaved: readonly string[] }): string | null {
  const fields = list(input.notSaved);
  if (!fields) return null;
  const verb = input.notSaved.length > 1 && new Set(input.notSaved).size > 1 ? "weren't" : "wasn't";
  return `${fields} ${verb} saved; the rest of the form is as shown. You haven't told me what happened yet, so there was nothing to draft from: tell me here and I'll write it in, or fill it in below.`;
}
