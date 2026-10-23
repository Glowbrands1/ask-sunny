import { matchGlossary } from "@/lib/ai/glossary";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";

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
  return `${heading}\n${chunk.content.trim().slice(0, 500)}`;
}

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
