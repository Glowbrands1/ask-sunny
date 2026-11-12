import { matchGlossary } from "@/lib/ai/glossary";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { policyQuoteWholeWordsEnabled } from "@/lib/config/chat-quality-flags";

/**
 * Violation words to the manual section that governs them.
 *
 * Staff describe what happened. The glossary line names the section. This
 * module turns those hits into the passage attached to a form. It quotes a
 * chunk only when that chunk's own text contains the heading. A heading with
 * no passage is cited by name and page, and no wording is written in for it.
 *
 * Called with enabled false, the proposal text is returned unchanged.
 */

export interface CitedSection {
  readonly section: string;
  readonly page: number | null;
}

export function citedSections(turns: readonly string[]): CitedSection[] {
  const seen = new Set<string>();
  const out: CitedSection[] = [];
  for (const turn of turns) {
    for (const hit of matchGlossary(turn)) {
      const section = hit.term.section;
      if (!section || hit.term.kind !== "policy") continue;
      const key = section.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ section, page: hit.term.page ?? null });
    }
  }
  return out;
}

function chunkFor(heading: string, chunks: readonly ManualChunk[]): ManualChunk | null {
  const key = heading.toLowerCase();
  const holdsHeading = (chunk: ManualChunk) => chunk.content.toLowerCase().includes(key);
  return (
    chunks.find((chunk) => (chunk.section ?? "").toLowerCase() === key && holdsHeading(chunk)) ??
    chunks.find((chunk) => holdsHeading(chunk)) ??
    null
  );
}

function passage(section: CitedSection, chunks: readonly ManualChunk[]): string {
  const where = section.page === null ? "" : ` (p.${section.page})`;
  const heading = `JBA Policy Manual — ${section.section}${where}`;
  const chunk = chunkFor(section.section, chunks);
  if (!chunk) return heading;
  return `${heading}\n${policyQuoteWholeWordsEnabled() ? quoted(chunk.content) : chunk.content.trim().slice(0, 500)}`;
}

const QUOTE_LIMIT = 500;

/*
 * POLICY_QUOTE_WHOLE_WORDS_ENABLED (port from Ask Bubbles: Gate-Bubbles-2's POLICY_CITATION gate, 12 Nov 2026): the
 * quote was cut at 500 characters mid-word ("… does not count as calling i") and kept the manual's markdown, so a
 * section could end on a stray "*". The quote ends at the last sentence (or, failing that, the last whole word) inside
 * the limit, with "…" when it was shortened, and carries no emphasis markers. Off, as before.
 */
function quoted(content: string): string {
  const plain = content.replace(/\*+/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (plain.length <= QUOTE_LIMIT) return plain;
  const head = plain.slice(0, QUOTE_LIMIT);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentence >= QUOTE_LIMIT / 2) return `${head.slice(0, sentence + 1).trimEnd()} …`;
  const word = head.search(/\s\S*$/);
  return `${(word > 0 ? head.slice(0, word) : head).trimEnd()} …`;
}

/** The quote as the cited block shows it (exported for its test). */
export const policyQuote = quoted;

/** Append mapped manual passages. Off, or with nothing mapped, the text is unchanged. */
export function withMappedPolicy(
  content: string,
  turns: readonly string[],
  chunks: readonly ManualChunk[],
  enabled: boolean,
): string {
  if (!enabled) return content;
  const sections = citedSections(turns).filter(
    (section) => !content.includes(`JBA Policy Manual — ${section.section}`),
  );
  if (sections.length === 0) return content;
  const block = sections.map((section) => passage(section, chunks)).join("\n\n");
  return `${content.trim()}\n\n**Policy cited from the manual**\n\n${block}`;
}
