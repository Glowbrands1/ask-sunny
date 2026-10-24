/**
 * An unverified name is the name on the form.
 *
 * A close roster match is offered in the same reply. It does not replace
 * the typed name, and it is not a question the manager has to answer before
 * the card exists. Used only when TYPED_NAME_PROCEEDS_ENABLED is on.
 */

export function inlineCloseMatch(typed: string, candidates: readonly string[]): string {
  const name = typed.trim();
  if (candidates.length === 1) {
    return `Did you mean **${candidates[0]}**? I'll keep **${name}** on the form unless you say otherwise.`;
  }
  const labels = candidates.map((candidate) => `**${candidate}**`);
  const listed = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels[0]!;
  return `Did you mean ${listed}? I'll keep **${name}** on the form unless you say otherwise.`;
}

/** The blocking confirmation, as opposed to the inline offer above. */
export function blocksOnNameQuestion(content: string): boolean {
  return /want to be sure before it goes on the form/i.test(content) || /who is this \*\*/i.test(content);
}
