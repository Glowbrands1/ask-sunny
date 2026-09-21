/**
 * ============================================================================
 * WHICH FORMS ASK SUNNY OFFERS WHEN THE MANAGER HAS NOT NAMED ONE
 * ============================================================================
 *
 * A leaf module with no imports on purpose: the chat proposal path, the
 * inventory answers and the prompt block all read it, and a list this small
 * kept in three places is a list that disagrees with itself within a release.
 *
 * ============================================================================
 * WITHHELD FROM THE CHOOSER IS NOT RETIRED
 * ============================================================================
 *
 * There is exactly one thing this list does: it removes a template from the
 * forms Sunny PUTS IN FRONT OF SOMEBODY who has not said which form they want
 * — the cards behind "Create a form from this conversation", the list under
 * "which form do you need", and the model's own suggestions. It is a rule
 * about what is SUGGESTED, and deliberately not about anything else:
 *
 *   THE TEMPLATE STAYS PUBLISHED. The row, its versions, its bundled source
 *   document and every form already created from it are untouched. Nothing
 *   here reaches the database.
 *
 *   FORMS -> CREATE A FORM STILL LISTS IT. That picker is a manager going to
 *   the library on purpose and choosing from it; this is Sunny volunteering a
 *   shortlist mid-conversation. Only the second one is narrowed.
 *
 *   NAMING IT STILL WORKS. "Create a Prescreen / Phone Interview Form" is a
 *   manager who has decided, and `template-intent.ts` still reads it — the
 *   permission and publication checks run exactly as before. Withholding a
 *   form from a suggestion list is not the same as refusing it, and a product
 *   that silently dropped a request it understood would be the worse bug.
 *
 *   "DO WE HAVE ONE?" IS STILL ANSWERED HONESTLY. `availabilityAnswer`
 *   resolves the named template by key, so a manager who asks after one of
 *   these is told it exists and where to open it, rather than being told it
 *   does not — which is what removing it from the library would have said.
 *
 * ============================================================================
 * WHY THESE FOUR
 * ============================================================================
 *
 * The whole Hiring & Interview category. They were being offered alongside the
 * HR & Performance forms every time a manager pressed "Create a form from this
 * conversation" from a coaching thread, which is four interview documents on
 * screen in a conversation that was never about a candidate. The business asked
 * for them to come out of the chooser; they remain in the library, and the
 * Hiring & Interview section of Forms -> Create a Form is unchanged.
 *
 * TO PUT ONE BACK, delete its line. Nothing else knows about this file.
 */
export const WITHHELD_FROM_CHOOSER: readonly string[] = [
  /* Prescreen / Phone Interview Form */
  "prescreen-phone-interview",
  /* Tanning Consultant Interview Form */
  "tanning-consultant-interview",
  /* First Round Management Interview Form */
  "management-interview-round-1",
  /* Second Round Management Interview Form */
  "management-interview-round-2",
];

/**
 * Whether Sunny may put this template forward to somebody who has not asked
 * for it by name.
 *
 * Keyed on the LIBRARY KEY rather than the name: a key is the template's
 * stored identity and survives a rename, and a rename is exactly the moment a
 * list matched on display names would quietly start offering the form again.
 */
export function offeredInChooser(templateKey: string): boolean {
  return !WITHHELD_FROM_CHOOSER.includes(templateKey);
}
