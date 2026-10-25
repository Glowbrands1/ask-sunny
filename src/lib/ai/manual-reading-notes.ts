/**
 * Reading notes for manual sentences a reply has read backwards.
 *
 * JBA Policy Manual p.19 says "Employees should keep cell phones on silent and
 * not on their person (this means not in back pockets, charging in the break
 * room, or sitting on top of a drawer till)". The bracket lists three places
 * the phone may NOT be. A live reply (conv_mvnoscyz200gtat, 25 Oct 2026) read
 * the middle item as permission: "the manual gives charging in the break room
 * as an example of where it belongs". HR's ruling (via QA, 25 Oct 2026):
 * charging in the break room is not allowed. Ported from the sibling app; the
 * sentence is in both apps' manuals.
 *
 * A later reply (conv_mvnsu3dz2mwoihh, 25 Oct 2026) read two of the three as
 * where the phone goes: "either charging in the break room or in a drawer
 * till". The note names all three places, the drawer till included.
 *
 * The manual text is not edited. When the grounding the model reads (the
 * cached full manual, the cached pinned manual block or the retrieved chunks)
 * holds that sentence, a short note
 * goes into the per-turn grounding block beside it. The note is not manual
 * text and is not a source. Nothing is added when the sentence is absent.
 */

/** The p.19 list, across the line breaks and comma variants the stored chunks carry. */
const P19_PHONE_LIST =
  /not\s+in\s+back\s+pockets\s*,?\s+charging\s+in\s+the\s+break\s+room\s*,?\s+or\s+sitting\s+on\s+top\s+of\s+a\s+drawer\s+till/i;

export const P19_PHONE_LIST_NOTE =
  "Reading note (p.19): 'not in back pockets, charging in the break room, or sitting on top of a drawer till' lists three places the phone may NOT be: not in a back pocket, not charging in the break room, and not sitting on top of a drawer till. None of the three is allowed; charging in the break room is not allowed. The manual does not give the break room or a drawer till as a place the phone belongs.";

const HEADER =
  "MANUAL READING NOTES\n\nThese notes are not manual text and are not cited. Each one says how to read a sentence that is in the manual text above.";

/** The notes that apply to these texts, or null when none of them holds a noted sentence. */
export function manualReadingNotes(texts: readonly (string | null | undefined)[]): string | null {
  const notes: string[] = [];
  if (texts.some((text) => typeof text === "string" && P19_PHONE_LIST.test(text))) {
    notes.push(P19_PHONE_LIST_NOTE);
  }
  if (notes.length === 0) return null;
  return `${HEADER}\n\n${notes.map((note) => `- ${note}`).join("\n")}`;
}

/**
 * The grounding block with the reading notes after it. `manualText` is the
 * manual the turn reads from the system prompt (the full manual, or the
 * pinned manual block when it is cached); that block itself is left as it is. Unchanged, byte for byte, when no noted
 * sentence is in either.
 */
export function withManualReadingNotes(grounding: string, manualText?: string | null): string {
  const notes = manualReadingNotes([grounding, manualText]);
  if (!notes) return grounding;
  return grounding.length > 0 ? `${grounding}\n\n${notes}` : notes;
}
