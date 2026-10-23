import { printedPageOf } from "@/lib/ingestion/extract/pdf-sections";
import {
  officialManualProvenance,
  type ManualChunk,
  type ManualSection,
} from "@/lib/forms/official-policy-manual";

import { citedSections } from "./violation-policy";

/**
 * A short citation for a coaching form, from chunk metadata.
 *
 * The page is the printed page on the chunk, a heading's own page, or a
 * footer the extractor already knows how to read. A missing page is left
 * out. Nothing here invents one, and an existing Direct policy line is
 * left alone.
 */

const NARRATIVE_KEY: Readonly<Record<string, string>> = {
  coaching: "coaching_details",
  "follow-up-coaching": "follow_up_observation",
};

export function citationPage(chunk: ManualChunk, heading: string): number | null {
  const listed = chunk.sections?.find((section) => section.heading.toLowerCase() === heading.toLowerCase());
  if (listed && listed.page > 0) return listed.page;
  if (typeof chunk.printedPage === "number" && chunk.printedPage > 0) return chunk.printedPage;
  for (const line of chunk.content.split("\n")) {
    const printed = printedPageOf(line);
    if (printed) return printed;
  }
  return null;
}

export function formatManualCitation(heading: string, page: number | null): string {
  const name = /policy/i.test(heading) ? heading.trim() : `${heading.trim()} Policy`;
  return page && page > 0 ? `${name}, JBA Policy Manual p.${page}` : `${name}, JBA Policy Manual`;
}

export function citationFromChunks(turns: readonly string[], chunks: readonly ManualChunk[]): string | null {
  const sections = citedSections(turns);
  if (sections.length === 0) return null;
  const lines = sections.map((section) => {
    const chunk =
      chunks.find((item) => (item.section ?? "").toLowerCase() === section.section.toLowerCase()) ??
      chunks.find((item) => item.content.toLowerCase().includes(section.section.toLowerCase())) ??
      null;
    const page = chunk ? citationPage(chunk, section.section) : null;
    return formatManualCitation(section.section, page);
  });
  return lines.join("; ");
}

export interface FlaggedManualIdentity {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly matchedBy: "tag" | "fallback";
}

export function withFlaggedPolicyCitation(input: {
  readonly enabled: boolean;
  readonly templateKey: string;
  readonly values: Record<string, string>;
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
}): Record<string, string> {
  return flaggedCitationWrite(input).values;
}

/**
 * Values plus the provenance a Corrective Action policy line needs.
 *
 * Coaching has no policy field, so the citation is appended to the
 * narrative and needs no provenance. A Direct policy line is written only
 * when it is empty, only with a printed page taken from a chunk, and only
 * with the manual's own provenance. Off, the values object is the one
 * passed in and provenance is empty.
 */
export function flaggedCitationWrite(input: {
  readonly enabled: boolean;
  readonly templateKey: string;
  readonly values: Record<string, string>;
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly manual?: FlaggedManualIdentity | null;
}): { values: Record<string, string>; provenance: Record<string, Record<string, unknown>> } {
  if (!input.enabled) return { values: input.values, provenance: {} };
  const found = linesFromChunks(input.notes, input.chunks);
  if (found.length === 0) return { values: input.values, provenance: {} };
  const line = found.map((item) => formatManualCitation(item.heading, item.page)).join("; ");

  const narrative = NARRATIVE_KEY[input.templateKey];
  if (narrative) {
    const current = input.values[narrative] ?? "";
    if (current.includes(line)) return { values: input.values, provenance: {} };
    const next = current.trim() ? `${current.trim()}\n\nPolicy reference: ${line}` : `Policy reference: ${line}`;
    return { values: { ...input.values, [narrative]: next }, provenance: {} };
  }

  const paged = found.filter((item): item is CitedLine & { page: number } => item.page !== null && item.page > 0);
  if (
    (input.templateKey === "dpoa" || input.templateKey === "policy-review") &&
    !(input.values.policy_language ?? "").trim() &&
    paged.length > 0 &&
    input.manual
  ) {
    const policy = paged.map((item) => formatManualCitation(item.heading, item.page)).join("; ");
    const sections: ManualSection[] = paged.map((item) => ({
      heading: item.heading,
      page: item.page,
      chunkIndex: item.chunkIndex,
      foundBy: item.foundBy,
    }));
    return {
      values: { ...input.values, policy_language: policy },
      provenance: {
        policy_language: officialManualProvenance({
          documentId: input.manual.documentId,
          documentTitle: input.manual.documentTitle,
          matchedBy: input.manual.matchedBy,
          ownerConfirmed: input.manual.matchedBy === "tag",
          sections,
        }) as Record<string, unknown>,
      },
    };
  }
  return { values: input.values, provenance: {} };
}

interface CitedLine {
  readonly heading: string;
  readonly page: number | null;
  readonly chunkIndex: number;
  readonly foundBy: ManualSection["foundBy"];
}

function linesFromChunks(notes: string, chunks: readonly ManualChunk[]): CitedLine[] {
  return citedSections([notes]).map((section) => {
    const chunk =
      chunks.find((item) => (item.section ?? "").toLowerCase() === section.section.toLowerCase()) ??
      chunks.find((item) => item.content.toLowerCase().includes(section.section.toLowerCase())) ??
      null;
    const listed = chunk?.sections?.find((item) => item.heading.toLowerCase() === section.section.toLowerCase());
    return {
      heading: section.section,
      page: chunk ? citationPage(chunk, section.section) : null,
      chunkIndex: chunk?.chunkIndex ?? 0,
      foundBy: listed ? "contents" : "page_heading",
    };
  });
}
