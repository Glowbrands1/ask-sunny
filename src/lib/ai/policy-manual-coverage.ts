import {
  isTableOfContents,
  manualDisplayTitle,
  type ManualChunk,
} from "@/lib/forms/official-policy-manual";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * ============================================================================
 * A QUESTION THAT NAMES THE JBA MANUAL IS ANSWERED FROM THE JBA MANUAL
 * ============================================================================
 *
 * Two questions a manager asked of the JB & Associates Employment Policy
 * Manual came back wrong, and both for the same reason: similarity search was
 * asked to cover a 110-chunk document with 14 slots.
 *
 *   "WHAT POLICIES AND TOPICS ARE IN THE JBA POLICY MANUAL?"
 *     Retrieval returned the cover, the introduction, ONE of the fifteen
 *     chunks the table of contents is split across, and three unrelated pages.
 *     The answer then listed the pages it had not been given — "pages 3
 *     through 20 ... isn't in front of me" — as though the manual had no
 *     attendance, pay or dress code sections. It has all three.
 *
 *   "IN THE JBA POLICY MANUAL EDITED 5.2025, WHAT DOES THE ATTENDANCE OR
 *    TARDINESS POLICY SAY?"
 *     Naming the manual pulled the query toward its title page and
 *     introduction, which filled the top of the ranking. The Attendance section
 *     (printed page 14) never ranked, and the answer came from the Salon
 *     Coaching Guide instead.
 *
 * So when a question names the manual, the manual's rows are read BY IDENTITY,
 * the same lookup a Corrective Action Form uses, and the part of it the
 * question needs is pinned:
 *
 *   A WHOLE-MANUAL QUESTION    the complete table of contents, every chunk of
 *                              it, so the answer is built from the manual's own
 *                              list of its sections and pages.
 *
 *   A TOPIC QUESTION           the sections whose printed heading matches the
 *                              topic, read off the heading metadata ingestion
 *                              recorded, not off body prose.
 *
 *   A TOPIC NO HEADING MATCHES the table of contents again, so the answer can
 *                              say what the manual does and does not list,
 *                              rather than guessing from whatever ranked.
 *
 * ONLY THIS MANUAL, AND ONLY WHEN IT IS NAMED. "What's the smoking policy?"
 * names no document and keeps the ordinary retrieval that already answers it.
 * Nothing here changes what any other document contributes.
 */

/** "JBA" or "JB & Associates", and a word that makes it the manual. */
const NAMES_COMPANY = /\b(?:jba|jb\s*(?:&|and)\s*associates)\b/i;
const NAMES_MANUAL = /\b(?:manual|handbook)\b/i;

export function namesOfficialPolicyManual(question: string): boolean {
  return NAMES_COMPANY.test(question) && NAMES_MANUAL.test(question);
}

/**
 * A question about the manual as a whole rather than one of its sections.
 *
 * "Policy" in the singular is deliberately not a cue: "what does the attendance
 * policy say" is a topic question. The cues are about the manual's contents.
 */
const OVERVIEW_CUES: readonly RegExp[] = [
  /\b(?:overview|outline|table of contents|contents)\b/i,
  /\b(?:what|which)\s+(?:policies|topics|sections|subjects|chapters)\b/i,
  /\b(?:all|main|major|every|list)\s+(?:of\s+)?(?:the\s+|its\s+)?(?:policies|topics|sections|chapters)\b/i,
  /\bwhat(?:'s|\s+is)?\s+(?:in|inside|covered\s+in)\s+(?:the\s+)?(?:jba|jb\b)/i,
  /\bwhat\s+does\s+(?:the\s+)?(?:jba|jb\b)[^?]*\b(?:cover|include|contain)\b/i,
];

export function isManualOverviewQuestion(question: string): boolean {
  return OVERVIEW_CUES.some((cue) => cue.test(question));
}

/**
 * Words that say nothing about which section is meant.
 *
 * The manual's own title words are here because the question names it, and
 * "policy", "company" and "employee" are here because a third of the manual's
 * headings contain one of them — matching on those would pin half the manual.
 */
const NOT_A_TOPIC = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "can", "cite",
  "company", "could", "do", "does", "edited", "employee", "employment", "for",
  "from", "general", "give", "handbook", "have", "how", "i", "in", "is", "it",
  "its", "jb", "jba", "manual", "me", "my", "of", "on", "or", "our", "page",
  "please", "policies", "policy", "regulations", "rule", "rules", "say", "says",
  "section", "sections", "should", "tell", "that", "the", "their", "there",
  "this", "to", "us", "we", "what", "whats", "when", "where", "which", "who",
  "with", "work", "would", "you", "your", "associates", "revised", "version",
]);

/** Lower-cased words, light plural folding, no numbers or stop words. */
function topicWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word))
    .map((word) =>
      word.endsWith("ies") && word.length > 4
        ? `${word.slice(0, -3)}y`
        : word.endsWith("s") && !word.endsWith("ss") && word.length > 3
          ? word.slice(0, -1)
          : word,
    )
    .filter((word) => !NOT_A_TOPIC.has(word));
}

/** At most this many section chunks are pinned for a topic question. */
const MAX_SECTION_CHUNKS = 8;
/** A section may run into this many following chunks that print no heading. */
const MAX_CONTINUATION_CHUNKS = 2;

export interface ManualSectionRef {
  readonly heading: string;
  readonly page: number;
}

export type PolicyManualCoverage =
  | {
      /** The complete table of contents was pinned. */
      readonly kind: "contents";
      readonly documentTitle: string;
      readonly rows: MatchedChunkRow[];
      /** True when the question named a topic no heading matched. */
      readonly unmatchedTopic: boolean;
    }
  | {
      /** The sections whose headings matched the question were pinned. */
      readonly kind: "sections";
      readonly documentTitle: string;
      readonly rows: MatchedChunkRow[];
      readonly sections: readonly ManualSectionRef[];
    };

/**
 * A pinned manual chunk, shaped as a retrieved one.
 *
 * Every identifying field comes from the database row. `similarity` is 0 because
 * inclusion never depended on it, which is the convention every pinned row
 * follows (`toRoleGroundingRow`).
 */
function toRow(
  document: { id: string; title: string; category: string },
  chunk: ManualChunk,
): MatchedChunkRow | null {
  if (!chunk.chunkId || !chunk.locator) return null;
  return {
    chunk_id: chunk.chunkId,
    document_id: document.id,
    document_title: document.title,
    category: document.category,
    locator: chunk.locator,
    page: chunk.page,
    section: chunk.section ?? null,
    content: chunk.content,
    similarity: 0,
  };
}

/**
 * Which of the manual's rows this question needs, or null for none.
 *
 * Pure, so the selection is tested against the real manual's chunk layout
 * without a database.
 */
export function selectPolicyManualCoverage(input: {
  readonly question: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string;
  readonly chunks: readonly ManualChunk[];
}): PolicyManualCoverage | null {
  const document = {
    id: input.documentId,
    title: input.documentTitle,
    category: input.documentCategory ?? "other",
  };
  const ordered = [...input.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const contents = ordered.filter((chunk) => isTableOfContents(chunk.content));

  const contentsCoverage = (unmatchedTopic: boolean): PolicyManualCoverage | null => {
    const rows = contents
      .map((chunk) => toRow(document, chunk))
      .filter((row): row is MatchedChunkRow => row !== null);
    return rows.length > 0
      ? { kind: "contents", documentTitle: document.title, rows, unmatchedTopic }
      : null;
  };

  if (isManualOverviewQuestion(input.question)) return contentsCoverage(false);

  const wanted = new Set(topicWords(input.question));
  if (wanted.size === 0) return null;

  /*
   * A SECTION MATCHES ON ITS PRINTED HEADING, never on its prose. Body text
   * mentions every topic somewhere — the Schedule Requests section says
   * "absenteeism" — and pinning on that would hand the model the wrong section
   * with a confident page number attached.
   */
  const picked: ManualChunk[] = [];
  const sections: ManualSectionRef[] = [];
  const pickedIndexes = new Set<number>();

  for (let position = 0; position < ordered.length; position += 1) {
    const chunk = ordered[position]!;
    if (isTableOfContents(chunk.content)) continue;

    const matched = (chunk.sections ?? []).filter((entry) =>
      topicWords(entry.heading).some((word) => wanted.has(word)),
    );
    if (matched.length === 0) continue;

    for (const entry of matched) {
      if (!sections.some((seen) => seen.heading === entry.heading && seen.page === entry.page)) {
        sections.push({ heading: entry.heading, page: entry.page });
      }
    }

    /* The chunk that prints the heading, then any that only continue it. */
    const run = [chunk];
    for (let next = position + 1; next < ordered.length; next += 1) {
      const following = ordered[next]!;
      if (run.length > MAX_CONTINUATION_CHUNKS) break;
      if ((following.sections ?? []).length > 0) break;
      if (isTableOfContents(following.content)) break;
      run.push(following);
    }

    for (const member of run) {
      if (pickedIndexes.has(member.chunkIndex)) continue;
      pickedIndexes.add(member.chunkIndex);
      picked.push(member);
    }
  }

  if (picked.length === 0) return contentsCoverage(true);

  const rows = picked
    .slice(0, MAX_SECTION_CHUNKS)
    .map((chunk) => toRow(document, chunk))
    .filter((row): row is MatchedChunkRow => row !== null);
  if (rows.length === 0) return null;

  return { kind: "sections", documentTitle: document.title, rows, sections };
}

/**
 * What the model is told about how much of the manual it has been given.
 *
 * THE FAILURE THIS PREVENTS is the model treating "not among my sources" as
 * "not in the manual". The markers are the ones the rows actually landed on
 * after assembly, so the note never points at a source that is not there.
 */
export function buildPolicyManualNote(
  coverage: PolicyManualCoverage,
  markers: readonly number[],
): string | null {
  if (markers.length === 0) return null;

  const title = manualDisplayTitle(coverage.documentTitle);
  const list = markers.map((marker) => `[S${marker}]`).join(", ");

  if (coverage.kind === "contents") {
    return `THE ${title.toUpperCase()} — ITS COMPLETE TABLE OF CONTENTS IS INCLUDED

- Sources ${list} are the complete table of contents of ${coverage.documentTitle}, taken from the manual itself: every section heading, with the page number the manual prints for it.
- To say what the manual covers, work from those contents pages and cite them. Name sections and pages exactly as the contents give them.
- The full text of most sections is NOT among your sources. A section listed in the contents IS in the manual: never call it missing, unavailable or not covered, and never list pages you "don't have" as though the manual lacked them. Say instead that you can look up any section's wording if asked.
- Do not state what a section requires unless that section's own text is among the sources.${
      coverage.unmatchedTopic
        ? "\n- The manual's section headings were searched for the topic of this question and none matched it. If the contents list no section for it, say the manual's table of contents does not list one — and point to the nearest section the contents DO list, if any — rather than saying the manual is silent."
        : ""
    }`;
  }

  const found = coverage.sections
    .map((section) => `${section.heading} (page ${section.page})`)
    .join("; ");

  return `THE ${title.toUpperCase()} — SECTIONS READ FOR THIS QUESTION

- The manual's own section headings were searched for this question, and these sections were taken from it directly: ${found}. They are sources ${list}.
- Answer what the manual says from those sources, and cite the section heading and page exactly as each source's locator gives them.
- If they do not answer part of the question, say these sections do not address it. Do not say the manual as a whole is silent: only the matching sections are included.
- If another document among the sources speaks to the same topic, keep it clearly separate from what the manual says, and never present it as the manual's policy.`;
}
