import { describedAttendanceKeys, readCaPolicy, statedOffenseKeys } from "@/lib/forms/ca-policy";
import { describedManualSection, namedManualSection } from "@/lib/forms/named-policy-section";
import {
  OFFENSE_MANUAL_SECTIONS,
  findManualSection,
  headingKey,
  manualSectionsFor,
  sectionHeadingsFor,
  type ManualChunk,
  type ManualSection,
} from "@/lib/forms/official-policy-manual";
import { sectionsNamedIn } from "@/lib/forms/policy-change";

/**
 * The manual sections a manager's account resolves, using the same readers
 * a Corrective Action uses. A heading is cited only when a chunk carries it.
 * Nothing here maps a word to a page.
 */

export function accountManualSections(
  notes: string,
  chunks: readonly ManualChunk[],
  jobTitle?: string | null,
): ManualSection[] {
  const text = notes ?? "";
  if (!text.trim() || chunks.length === 0) return [];

  const reading = readCaPolicy(text);
  const named = reading.stated === null ? namedManualSection({ text, chunks }) : null;
  const described = reading.stated === null && !named ? describedManualSection({ text, chunks }) : null;
  const keys =
    statedOffenseKeys(reading, text) ??
    describedAttendanceKeys(text) ??
    (named ? [named.offenseKey] : described ? [described.offenseKey] : []);

  const found: ManualSection[] = [];
  const keep = (section: ManualSection | null | undefined) => {
    if (!section || !section.heading.trim()) return;
    const key = headingKey(section.heading);
    if (found.some((seen) => headingKey(seen.heading) === key)) return;
    found.push(section);
  };

  if (named) keep(named.section);
  if (described) keep(described.section);
  for (const section of manualSectionsFor({ chunks, offenseKeys: keys, jobTitle, notes: text })) keep(section);
  for (const section of sectionsNamedIn({ text, chunks, jobTitle })) keep(section);

  for (const key of Object.keys(OFFENSE_MANUAL_SECTIONS)) {
    if (!keys.includes(key)) continue;
    const withNotes = sectionHeadingsFor({ offenseKeys: [key], notes: text, jobTitle }).flat();
    const bare = new Set(
      sectionHeadingsFor({ offenseKeys: [key], notes: "", jobTitle }).flat().map((heading) => headingKey(heading)),
    );
    for (const heading of withNotes) {
      if (bare.has(headingKey(heading))) continue;
      keep(findManualSection(chunks, [heading]) ?? headingOnChunk(chunks, heading));
    }
  }

  return found;
}

/** A heading printed on a chunk whose sheet has no usable page. Page 0 means "omit the page". */
function headingOnChunk(chunks: readonly ManualChunk[], heading: string): ManualSection | null {
  const key = headingKey(heading);
  if (!key) return null;
  for (const chunk of chunks) {
    const listed = (chunk.sections ?? []).find((entry) => headingKey(entry.heading) === key);
    if (listed) {
      return {
        heading: listed.heading.trim(),
        page: listed.page > 0 ? listed.page : 0,
        chunkIndex: chunk.chunkIndex,
        foundBy: "sheet_heading",
      };
    }
    if (chunk.section && headingKey(chunk.section) === key) {
      const printed = chunk.printedPage ?? chunk.page;
      return {
        heading: chunk.section.trim(),
        page: typeof printed === "number" && printed > 0 ? printed : 0,
        chunkIndex: chunk.chunkIndex,
        foundBy: "sheet_heading",
      };
    }
  }
  return null;
}
