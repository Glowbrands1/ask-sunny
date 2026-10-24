/**
 * ============================================================================
 * THE NEWEST EDITION OF A WOVEN DOCUMENT IS THE ONE ASK SUNNY KEEPS
 * ============================================================================
 *
 * Woven can publish the same document more than once: a 2024 file, a 2025
 * file, and a later revision of that file. Those are different Woven records,
 * so they become different Ask Sunny documents. Pau's rule is that the newest
 * edition wins. The older one stays in the library for audit — nothing is
 * deleted — and it is not searchable (`status = superseded`, `indexed = false`,
 * `superseded_by` the current document).
 *
 * WHICH DOCUMENTS ARE THE SAME ONE is read from the title and the file name.
 * The edition date and the words that only introduce an edition (edited,
 * master, acknowledgement, …) are removed. What remains is the family. A
 * Woven record's own parts (a policy and its PDF) share one publication id
 * and are never editions of each other.
 *
 * THE DATE is the month and year written in the name. "Edited 10-2024" is
 * older than "Edited 5.2025". A year with no month is not older than a month
 * in that same year, so two 2025 copies both stay. When the name has no date,
 * Woven's own updated time is the date. A named edition is not compared with
 * an updated time: if one copy says when it was edited and the other does not,
 * neither is retired.
 *
 * OFF, none of this runs. The flag is `EDITION_SUPERSESSION_ENABLED`.
 */

import type { ManifestItem } from "./types";

export interface EditionCandidate {
  documentId: string;
  title: string;
  fileName: string | null;
  /**
   * Parts of one Woven record. A policy body and its attachment share this
   * and are one publication, not two editions.
   */
  publicationId: string;
  sourceUpdatedAt: string | null;
}

export interface EditionSupersession {
  documentId: string;
  supersededBy: string;
  family: string;
}

export interface EditionStamp {
  year: number;
  /** Null when the name only carries a year. */
  month: number | null;
  /** A date written on the document, or Woven's updated time when it has none. */
  source: "title" | "updated";
  time: number;
}

const EDITION_WORDS = new Set([
  "edited",
  "revised",
  "updated",
  "revision",
  "version",
  "master",
  "acknowledgement",
  "acknowledgment",
  "with",
  "final",
  "draft",
  "rev",
  "copy",
]);

const norm = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** The document with the edition date and edition words removed, or null when too little remains to be a family. */
export function documentFamily(title: string, fileName?: string | null): string | null {
  return stem(title) ?? stem(stripExtension(fileName ?? ""));
}

export function editionStamp(input: { title: string; fileName?: string | null; sourceUpdatedAt?: string | null }): EditionStamp | null {
  const titled = stampFromText(`${input.title} ${input.fileName ?? ""}`);
  if (titled) return titled;
  const updated = Date.parse(input.sourceUpdatedAt ?? "");
  if (!Number.isFinite(updated)) return null;
  const date = new Date(updated);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, source: "updated", time: updated };
}

/** True when `older` is an earlier edition than `newer`. Same precision and same source only. */
export function isStrictlyOlder(older: EditionStamp, newer: EditionStamp): boolean {
  if (older.source !== newer.source) return false;
  if (older.source === "updated") return older.time < newer.time;
  if (older.year !== newer.year) return older.year < newer.year;
  if (older.month != null && newer.month != null) return older.month < newer.month;
  return false;
}

/**
 * Older editions of one family, each pointing at the current document.
 * A tie (two May 2025 copies) supersedes nothing in that tie. A 2024 copy
 * is still older than both.
 */
export function planEditionSupersession(candidates: readonly EditionCandidate[]): EditionSupersession[] {
  const groups = new Map<string, EditionCandidate[]>();
  for (const candidate of candidates) {
    const family = documentFamily(candidate.title, candidate.fileName);
    if (!family) continue;
    const list = groups.get(family) ?? [];
    list.push(candidate);
    groups.set(family, list);
  }

  const plan: EditionSupersession[] = [];
  for (const [family, docs] of groups) {
    const publications = new Map<string, EditionCandidate[]>();
    for (const doc of docs) {
      const list = publications.get(doc.publicationId) ?? [];
      list.push(doc);
      publications.set(doc.publicationId, list);
    }
    if (publications.size < 2) continue;

    const stamped = [...publications.entries()].map(([key, parts]) => ({
      key,
      parts,
      stamp: bestStamp(parts),
      representative: representativeId(parts),
    }));
    const winners = stamped.filter(
      (pub) => !stamped.some((other) => other.key !== pub.key && pub.stamp && other.stamp && isStrictlyOlder(pub.stamp, other.stamp)),
    );
    const winner = [...winners].sort((a, b) => a.representative.localeCompare(b.representative))[0];
    if (!winner) continue;

    for (const pub of stamped) {
      if (winners.includes(pub) || !pub.stamp) continue;
      const beaten = winners.every((current) => current.stamp && isStrictlyOlder(pub.stamp!, current.stamp));
      if (!beaten) continue;
      for (const part of pub.parts) {
        if (part.documentId === winner.representative) continue;
        plan.push({ documentId: part.documentId, supersededBy: winner.representative, family });
      }
    }
  }
  return plan;
}

/**
 * Manifest rows an older edition must not ingest. The document id already on
 * the row is kept; a row that was never ingested is simply not ingested.
 */
export function holdOlderEditions<T extends ManifestItem>(
  items: readonly T[],
  documentIdFor: (item: Pick<ManifestItem, "source" | "contentType" | "entityId" | "partKey">) => string,
): { items: T[]; plan: EditionSupersession[] } {
  const idOf = (item: ManifestItem) => item.knowledgeDocumentId ?? documentIdFor(item);
  const competing = items.filter(isCompetingEdition);
  const plan = planEditionSupersession(
    competing.map((item) => ({
      documentId: idOf(item),
      title: item.title,
      fileName: item.fileName,
      publicationId: `${item.contentType}:${item.entityId}`,
      sourceUpdatedAt: item.sourceUpdatedAt,
    })),
  );
  const olderIds = new Set(plan.map((row) => row.documentId));
  return {
    plan,
    items: items.map((item) => {
      if (!olderIds.has(idOf(item))) return item;
      return {
        ...item,
        pendingAction: "none",
        state: "EXCLUDED",
        reason: "older_edition",
        inAskSunny: false,
        syncedFingerprint: item.observedFingerprint,
        lastError: null,
        errorCategory: null,
        retryCount: 0,
        nextRetryAt: null,
      };
    }),
  };
}

export interface SectionRow {
  document_id: string;
  document_title: string;
  section: string | null;
  content: string;
  similarity: number;
}

/**
 * Two indexed copies of one family can carry the same section. Keep one so
 * the citation does not flip between them. The newer edition wins; a tie
 * keeps the higher score, then the lower document id.
 */
export function dedupeIdenticalSections<T extends SectionRow>(rows: readonly T[]): T[] {
  const kept: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const row of rows) {
    const key = identicalSectionKey(row);
    if (!key) {
      kept.push(row);
      continue;
    }
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, kept.length);
      kept.push(row);
      continue;
    }
    if (preferSection(row, kept[existing]!)) kept[existing] = row;
  }
  return kept;
}

function isCompetingEdition(item: ManifestItem): boolean {
  if (item.pendingAction === "retire") return false;
  if (item.state === "REMOVED" || item.state === "UNPUBLISHED" || item.state === "BLOCKED" || item.state === "NEEDS_REVIEW") return false;
  if (
    item.reason === "unsupported_format" ||
    item.reason === "not_published" ||
    item.reason === "status_not_recognised" ||
    item.reason === "audience_excluded" ||
    item.reason === "audience_needs_review"
  ) {
    return false;
  }
  return item.pendingAction === "ingest" || item.inAskSunny || item.reason === "older_edition";
}

function identicalSectionKey(row: SectionRow): string | null {
  const family = documentFamily(row.document_title);
  if (!family) return null;
  const content = norm(row.content);
  if (content.length < 20) return null;
  return `${family}\u0000${content}`;
}

function preferSection(candidate: SectionRow, current: SectionRow): boolean {
  const candidateStamp = editionStamp({ title: candidate.document_title });
  const currentStamp = editionStamp({ title: current.document_title });
  if (candidateStamp && currentStamp && isStrictlyOlder(currentStamp, candidateStamp)) return true;
  if (candidateStamp && currentStamp && isStrictlyOlder(candidateStamp, currentStamp)) return false;
  if (candidate.similarity !== current.similarity) return candidate.similarity > current.similarity;
  return candidate.document_id < current.document_id;
}

function bestStamp(parts: readonly EditionCandidate[]): EditionStamp | null {
  const stamps = parts
    .map((part) => editionStamp(part))
    .filter((stamp): stamp is EditionStamp => stamp !== null);
  const titled = stamps.filter((stamp) => stamp.source === "title");
  const pool = titled.length > 0 ? titled : stamps;
  if (pool.length === 0) return null;
  return pool.reduce((best, stamp) => (isStrictlyOlder(best, stamp) ? stamp : best));
}

function representativeId(parts: readonly EditionCandidate[]): string {
  const pdf = parts.find((part) => /\.pdf$/i.test(part.fileName ?? ""));
  const chosen = pdf ?? [...parts].sort((a, b) => a.documentId.localeCompare(b.documentId))[0]!;
  return chosen.documentId;
}

function stem(value: string): string | null {
  let text = norm(value);
  text = text.replace(/\.[a-z0-9]{2,5}$/i, "");
  text = text.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ");
  text = text.replace(/\b\d{1,2}[./-]\d{4}\b/g, " ");
  text = text.replace(/\b(?:19|20)\d{2}\b/g, " ");
  text = text.replace(/[^a-z0-9]+/g, " ");
  const words = text
    .split(" ")
    .filter((word) => word && !EDITION_WORDS.has(word) && !/^\d+$/.test(word));
  if (words.length < 2) return null;
  const joined = words.join(" ");
  if (joined.replace(/ /g, "").length < 8) return null;
  return joined;
}

function stampFromText(text: string): EditionStamp | null {
  const lower = text.toLowerCase();
  let best: { year: number; month: number } | null = null;
  for (const match of lower.matchAll(/\b(\d{1,2})[./-](\d{4})\b/g)) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    if (month < 1 || month > 12 || year < 1990 || year > 2100) continue;
    if (!best || year > best.year || (year === best.year && month > best.month)) best = { year, month };
  }
  if (best) return { year: best.year, month: best.month, source: "title", time: Date.UTC(best.year, best.month - 1, 1) };
  const years = [...lower.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length === 0) return null;
  const year = Math.max(...years);
  return { year, month: null, source: "title", time: Date.UTC(year, 0, 1) };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
}
