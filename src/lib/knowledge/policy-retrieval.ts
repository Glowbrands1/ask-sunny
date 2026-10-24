import { sectionTitleMatches } from "./hybrid-rank";
import { scopeToCurrentManual } from "./current-manual-scope";
import type { MatchedChunkRow } from "./mappers";

/**
 * Plain-language corrective-action wording, and the JBA section it means.
 *
 * The manual does not say "insubordination" or "slippers". A vector search
 * over the whole Woven library ranks a training manual ahead of the section
 * a Corrective Action is supposed to cite. These phrases name that section
 * so hybrid keyword search and the ranker can put it first.
 */
const SYNONYMS: readonly { readonly pattern: RegExp; readonly section: string }[] = [
  {
    pattern: /\b(?:insubordination|acknowledg(?:e)?ment|acknowledge|refusal)\b/i,
    section: "Standards of Conduct",
  },
  {
    pattern: /\b(?:uniform|slippers|leggings|shoes)\b/i,
    section: "Dress Code for The Company",
  },
  {
    pattern: /\b(?:tardy|tardiness|late to (?:her |his |their |a )?shift|showed up late for shift)\b/i,
    section: "Attendance",
  },
  {
    pattern: /\b(?:opened late|opening the (?:store|salon) late|late opening|open(?:ing)? the store late)\b/i,
    section: "Late Opening",
  },
  {
    pattern: /\b(?:cell phones?|cellphone)\b/i,
    section: "Cell Phone/Smart Watch Policy",
  },
];

export function policySectionsFor(text: string): string[] {
  const found: string[] = [];
  for (const entry of SYNONYMS) {
    if (!entry.pattern.test(text)) continue;
    if (!found.some((section) => section.toLowerCase() === entry.section.toLowerCase())) found.push(entry.section);
  }
  return found;
}

/** A corrective action, or a question the synonym map can place in the manual. */
export function isCaOrPolicyQuestion(text: string): boolean {
  if (/\b(?:corrective actions?|\bcas?\b|write[- ]?ups?)\b/i.test(text)) return true;
  if (policySectionsFor(text).length > 0) return true;
  return /\bpolic(?:y|ies)\b/i.test(text);
}

/**
 * The manager's words, then the manual section they mean.
 * Hybrid search ORs the extra words. A section already named is not repeated.
 */
export function expandPolicyQuery(text: string): string {
  const extras = policySectionsFor(text).filter((section) => !text.toLowerCase().includes(section.toLowerCase()));
  if (extras.length === 0) return text;
  return `${text}\n${extras.join("\n")}`;
}

function isJbaManual(row: Pick<MatchedChunkRow, "document_title">): boolean {
  return /\bjba policy manual\b/i.test(row.document_title);
}

function contentKey(row: MatchedChunkRow): string {
  const section = (row.section ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const content = row.content.trim().toLowerCase().replace(/\s+/g, " ");
  return `${section}\0${content}`;
}

/** Two indexed copies of the same manual text take one slot. The nearer copy stays. */
export function collapseIdenticalJbaCopies(rows: readonly MatchedChunkRow[]): MatchedChunkRow[] {
  const best = new Map<string, MatchedChunkRow>();
  for (const row of rows) {
    if (!isJbaManual(row)) continue;
    const key = contentKey(row);
    const existing = best.get(key);
    if (!existing || row.similarity > existing.similarity) best.set(key, row);
  }
  const seen = new Set<string>();
  const kept: MatchedChunkRow[] = [];
  for (const row of rows) {
    if (!isJbaManual(row)) {
      kept.push(row);
      continue;
    }
    const winner = best.get(contentKey(row));
    if (!winner || winner.chunk_id !== row.chunk_id || seen.has(winner.chunk_id)) continue;
    seen.add(winner.chunk_id);
    kept.push(winner);
  }
  return kept;
}

function pinsSection(row: MatchedChunkRow, sections: readonly string[]): boolean {
  const heading = (row.section ?? "").trim();
  return sections.some(
    (section) => heading.toLowerCase() === section.toLowerCase() || sectionTitleMatches(section, heading),
  );
}

/**
 * For a corrective-action or policy question, the current JBA manual fills
 * the list and a mapped section leads. Identical copies are already one row.
 * Any other question only loses the duplicate copy.
 */
export function orderPolicyRetrieval(
  rows: readonly MatchedChunkRow[],
  question: string,
  limit: number,
): MatchedChunkRow[] {
  const collapsed = collapseIdenticalJbaCopies(rows);
  if (!isCaOrPolicyQuestion(question)) return collapsed.slice(0, limit);
  const manuals = collapsed.filter((row) => isJbaManual(row));
  if (manuals.length === 0) return collapsed.slice(0, limit);
  const current = scopeToCurrentManual(manuals, { limit: manuals.length });
  const sections = policySectionsFor(question);
  const pinned = current.filter((row) => pinsSection(row, sections));
  const rest = current.filter((row) => !pinned.includes(row));
  return [...pinned, ...rest].slice(0, limit);
}
