/**
 * Extractor labels that say how a file was READ, not where in it a passage
 * sits: a plain-text document's chunks are "Text", a Word document without
 * headings "Document body". They are never shown as a place in a policy — not
 * on a chat source card, not in a form's source line.
 */
export const GENERIC_LOCATOR = /^(?:text|document body|body|content|document)$/i;

/** A chunk locator as a person may see it: its real page or section, or nothing. */
export function displayLocator(locator: string | null | undefined): string {
  const text = (locator ?? "").replace(/\s+/g, " ").trim();
  return GENERIC_LOCATOR.test(text) ? "" : text;
}
