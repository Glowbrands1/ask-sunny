import { headingOf } from "@/lib/ingestion/extract/pdf-sections";
import {
  headingKey,
  isTableOfContents,
  type ManualChunk,
} from "@/lib/forms/official-policy-manual";

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
    pattern: /\b(?:insubordination|acknowledg(?:e)?ments?|acknowledge|refus(?:al|ed|es|e))\b/i,
    section: "Standards of Conduct",
  },
  {
    pattern: /\b(?:uniform|slippers|leggings|shoes)\b/i,
    section: "Dress Code for The Company",
  },
  {
    pattern:
      /\b(?:tardy|tardiness|late (?:to|for) (?:her |his |their |a )?shift|showed up late for shift)\b/i,
    section: "Attendance",
  },
  {
    pattern:
      /\b(?:opened late|store opened late|opening the (?:store|salon) late|late opening|open(?:ed|ing)? the (?:store|salon) late)\b/i,
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

/** A write-up, named as one. */
export function isCorrectiveActionQuestion(text: string): boolean {
  return /\b(?:corrective actions?|\bcas?\b|write[- ]?ups?)\b/i.test(text);
}

/**
 * Stay on the manual when the manager is writing a corrective action, or
 * when a mapped incident does not already name the manual. A question that
 * names the JBA Policy Manual and asks what it says keeps the other documents.
 */
function restrictsToManual(text: string): boolean {
  if (isCorrectiveActionQuestion(text)) return true;
  return policySectionsFor(text).length > 0 && !/\bjba policy manual\b/i.test(text);
}

/** A corrective action, or a question the synonym map or the word "policy" can place in the manual. */
export function isCaOrPolicyQuestion(text: string): boolean {
  if (isCorrectiveActionQuestion(text)) return true;
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

/**
 * Topics the top-20 vector shortlist misses, and the JBA Policy Manual
 * sections that answer them.
 *
 * Production document `ce6b00f1-ff30-565f-b446-53fd268a1695`. The right
 * chunks rank from 14th to 97th, the keyword search drops "W-2", and the
 * 0.78 floor keeps the recall rerank from running. The chat path reads
 * these headings from the official manual by identity — the same lookup a
 * form uses — only when `MANUAL_TOPIC_PIN_ENABLED` is on. This map is not
 * part of `policySectionsFor`, so a flags-off question is searched and
 * ordered exactly as before.
 *
 * Chunk 121 is labelled "Time Records" and still prints
 * "Schedule Requests/General availability Changes". The heading is matched
 * on that line, not only on the section label.
 */
const MANUAL_TOPIC_PINS: readonly { readonly pattern: RegExp; readonly sections: readonly string[] }[] = [
  {
    pattern:
      /\b(?:time[\s-]*off|request(?:ing|ed|s)?[\s-]+off|sick\s+days?|paid\s+time\s+off|pto|vacations?)\b/i,
    sections: [
      "Paid time Off (PTO)",
      "Usage",
      "PTO Usage",
      "Schedule Requests/General availability Changes",
    ],
  },
  {
    pattern: /\bw-?\s?2(?:['’]s|s)?\b/i,
    sections: ["Accessing W-2's"],
  },
  {
    pattern: /\b(?:direct\s+deposit|pay\s*checks?)\b/i,
    sections: ["Pay Periods"],
  },
];

const SCHEDULE_REQUESTS = headingKey("Schedule Requests/General availability Changes");

/** How many following chunks with no heading of their own stay with a pinned section. */
const MAX_TOPIC_CONTINUATION = 2;
/** A topic pin is a few sections, not the rest of the manual. */
const MAX_TOPIC_CHUNKS = 12;

export function manualTopicSections(text: string): string[] {
  const found: string[] = [];
  for (const entry of MANUAL_TOPIC_PINS) {
    if (!entry.pattern.test(text)) continue;
    for (const section of entry.sections) {
      if (!found.some((item) => headingKey(item) === headingKey(section))) found.push(section);
    }
  }
  return found;
}

function matchesTopicHeading(key: string, wanted: ReadonlySet<string>): boolean {
  if (key === "") return false;
  if (wanted.has(key)) return true;
  if (wanted.has(SCHEDULE_REQUESTS) && key === "schedule requests") return true;
  // A heading printed with its page number on the same line: "Pay Periods 38".
  for (const heading of wanted) {
    if (heading.split(" ").length < 2) continue;
    const rest = key.startsWith(`${heading} `) ? key.slice(heading.length + 1) : "";
    if (/^\d{1,3}$/.test(rest)) return true;
  }
  return false;
}

function topicHeadingKeys(chunk: ManualChunk): string[] {
  const keys: string[] = [];
  if (chunk.section) keys.push(headingKey(chunk.section));
  for (const entry of chunk.sections ?? []) keys.push(headingKey(entry.heading));
  if (isTableOfContents(chunk.content)) return keys.filter((key) => key !== "");
  for (const line of chunk.content.split("\n")) {
    if (/\.{4,}/.test(line)) continue;
    const printed = headingOf(line);
    keys.push(headingKey(printed ?? line));
  }
  return keys.filter((key) => key !== "");
}

function chunkPrintsTopic(chunk: ManualChunk, wanted: ReadonlySet<string>): boolean {
  if (isTableOfContents(chunk.content)) return false;
  return topicHeadingKeys(chunk).some((key) => matchesTopicHeading(key, wanted));
}

/**
 * A heading that is not one of the pinned sections. Body lines are not
 * headings: only the label, the recorded headings, and a line `headingOf`
 * accepts. That is what stops a continuation from running into the next
 * section.
 */
function opensAnotherSection(chunk: ManualChunk, wanted: ReadonlySet<string>): boolean {
  const keys: string[] = [];
  if (chunk.section) keys.push(headingKey(chunk.section));
  for (const entry of chunk.sections ?? []) keys.push(headingKey(entry.heading));
  for (const line of chunk.content.split("\n")) {
    if (/\.{4,}/.test(line)) continue;
    const printed = headingOf(line);
    if (printed) keys.push(headingKey(printed));
  }
  return keys.some((key) => key !== "" && !matchesTopicHeading(key, wanted));
}

function topicRow(
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
 * The manual chunks for a mapped topic, in manual order.
 *
 * Empty when the question maps to nothing, or when this manual does not
 * print the heading. A contents page is never a section. A chunk labelled
 * "Time Records" is included when its own lines print Schedule Requests.
 */
export function pinManualTopicRows(input: {
  readonly question: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string;
  readonly chunks: readonly ManualChunk[];
}): MatchedChunkRow[] {
  const sections = manualTopicSections(input.question);
  if (sections.length === 0 || input.chunks.length === 0) return [];
  const wanted = new Set(sections.map((section) => headingKey(section)));
  const document = {
    id: input.documentId,
    title: input.documentTitle,
    category: input.documentCategory ?? "policies_compliance",
  };
  const ordered = [...input.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const picked: ManualChunk[] = [];
  const seen = new Set<number>();

  const take = (chunk: ManualChunk) => {
    if (seen.has(chunk.chunkIndex) || picked.length >= MAX_TOPIC_CHUNKS) return;
    if (!chunk.chunkId || !chunk.locator) return;
    seen.add(chunk.chunkIndex);
    picked.push(chunk);
  };

  for (let index = 0; index < ordered.length; index += 1) {
    const chunk = ordered[index]!;
    if (!chunkPrintsTopic(chunk, wanted)) continue;
    take(chunk);
    let extra = 0;
    for (let next = index + 1; next < ordered.length && extra < MAX_TOPIC_CONTINUATION; next += 1) {
      const following = ordered[next]!;
      if (isTableOfContents(following.content)) break;
      if (chunkPrintsTopic(following, wanted)) break;
      if (opensAnotherSection(following, wanted)) break;
      take(following);
      extra += 1;
    }
  }

  return picked
    .map((chunk) => topicRow(document, chunk))
    .filter((row): row is MatchedChunkRow => row !== null);
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
 * A corrective action, and a mapped incident that does not already name
 * the manual, are answered from the current JBA manual: a mapped section
 * leads, and a training manual does not take a slot. A policy question
 * that names the manual boosts it and still keeps the other documents
 * behind it. Any other question only loses the duplicate copy.
 */
export function orderPolicyRetrieval(
  rows: readonly MatchedChunkRow[],
  question: string,
  limit: number,
): MatchedChunkRow[] {
  const collapsed = collapseIdenticalJbaCopies(rows);
  if (!isCaOrPolicyQuestion(question)) return collapsed.slice(0, limit);
  const manuals = collapsed.filter((row) => isJbaManual(row));
  const others = collapsed.filter((row) => !isJbaManual(row));
  if (manuals.length === 0) return collapsed.slice(0, limit);
  const current = scopeToCurrentManual(manuals, { limit: manuals.length });
  const sections = policySectionsFor(question);
  const pinned = current.filter((row) => pinsSection(row, sections));
  const rest = current.filter((row) => !pinned.includes(row));
  const ranked = restrictsToManual(question) ? [...pinned, ...rest] : [...pinned, ...rest, ...others];
  return ranked.slice(0, limit);
}
