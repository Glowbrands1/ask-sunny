import { findManualSection, type ManualChunk } from "@/lib/forms/official-policy-manual";
import type { SourceCitation } from "@/types";

import type { AskResponse } from "./types";

/**
 * A JBA Policy Manual citation stays only when that heading and page are
 * in the current manual chunks. Anything else cited is left alone.
 */

const MANUAL_LINE = /([^,\n]{2,120}?),\s*JBA Policy Manual(?:\s+p\.(\d+))?/gi;

export function headingAndPageInManual(heading: string, page: number | null, chunks: readonly ManualChunk[]): boolean {
  const tail = heading.split(/[.!?]\s+/).pop() ?? heading;
  const cleaned = tail
    .replace(/^.*policy reference:\s*/i, "")
    .replace(/^(?:see|also|and)\s+/i, "")
    .replace(/\s+policy$/i, "")
    .trim();
  if (!cleaned) return false;
  const section = findManualSection(chunks, [cleaned]);
  if (!section || section.page <= 0) return false;
  if (page === null) return true;
  return section.page === page;
}

export function dropUnverifiedManualLines(content: string, chunks: readonly ManualChunk[]): string {
  const next = content.replace(MANUAL_LINE, (full, heading: string, page: string | undefined) => {
    const printed = page ? Number(page) : null;
    return headingAndPageInManual(heading, printed, chunks) ? full : "";
  });
  return next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function keepCurrentManualCitations(
  citations: readonly SourceCitation[],
  chunks: readonly ManualChunk[],
): SourceCitation[] {
  return citations.filter((citation) => {
    if (!isManualCitation(citation)) return true;
    const pageMatch = /page\s+(\d+)/i.exec(citation.locator);
    const heading = citation.excerpt.split(/[.\n]/)[0]?.trim() ?? "";
    return headingAndPageInManual(heading, pageMatch ? Number(pageMatch[1]) : null, chunks);
  });
}

export function withVerifiedCitations(response: AskResponse, chunks: readonly ManualChunk[]): AskResponse {
  const content = dropUnverifiedManualLines(response.content, chunks);
  const citations = keepCurrentManualCitations(response.citations, chunks);
  if (content === response.content.trim() && citations.length === response.citations.length) return response;
  return { ...response, content, citations };
}

function isManualCitation(citation: SourceCitation): boolean {
  return /policy manual/i.test(citation.documentTitle) || /\bjba\b/i.test(citation.documentTitle);
}
