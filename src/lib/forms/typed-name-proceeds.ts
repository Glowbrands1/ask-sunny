/**
 * An unverified name is the name on the form.
 *
 * A close roster match is one note in the same reply as the card: "Woven
 * has **Jane Doe** — say so if that's who you mean. Carry on; do not wait."
 * It does not replace the typed name, and it is not asked again on a later
 * turn. A name that is not in Woven at all is not mentioned. Used only when
 * TYPED_NAME_PROCEEDS_ENABLED is on.
 */

export function inlineCloseMatch(_typed: string, candidates: readonly string[]): string {
  const labels = candidates.map((candidate) => `**${candidate}**`);
  const listed =
    labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : (labels[0] ?? "");
  return `Woven has ${listed} — say so if that's who you mean. Carry on; do not wait.`;
}

/** The note was already said. A later turn does not ask it again. */
export function wovenNoteAlreadyShown(history: readonly { readonly content: string }[]): boolean {
  return history.some((message) => /Woven has \*\*/.test(message.content));
}

/** The blocking confirmation, as opposed to the inline offer above. */
export function blocksOnNameQuestion(content: string): boolean {
  return /want to be sure before it goes on the form/i.test(content) || /who is this \*\*/i.test(content);
}
