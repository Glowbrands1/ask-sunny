/**
 * An unverified name is the name on the form.
 *
 * A close roster match is one note under the card: "Woven has Jane Doe".
 * It does not replace the typed name, it is not a question, and it does not
 * hold the card. A name that is not close to anyone in Woven gets no note.
 * Used only when TYPED_NAME_PROCEEDS_ENABLED is on.
 */

export function inlineCloseMatch(_typed: string, candidates: readonly string[]): string {
  const labels = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  const listed =
    labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : (labels[0] ?? "");
  return listed ? `Woven has ${listed}` : "";
}

/** The note was already said in a reply. It is not asked again as a question. */
export function wovenNoteAlreadyShown(history: readonly { readonly content: string }[]): boolean {
  return history.some((message) => /Woven has (?:\*\*)?[A-Za-z]/.test(message.content));
}

/** The blocking confirmation, as opposed to the inline offer above. */
export function blocksOnNameQuestion(content: string): boolean {
  return /want to be sure before it goes on the form/i.test(content) || /who is this \*\*/i.test(content);
}
