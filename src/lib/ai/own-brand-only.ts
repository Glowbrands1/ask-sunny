import { ownBrandOnlyEnabled } from "@/lib/config/chat-quality-flags";
import { ACTIVE_BRAND } from "@/lib/brand";

import { EXCLUDED_BRAND } from "./full-manual-context";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * ONLY THIS COMPANY'S BRAND IN A REPLY (OWN_BRAND_ONLY_ENABLED, default off; Pau, 6 Nov 2026)
 * ============================================================================
 *
 * The JBA Policy Manual covers every brand the company operates, and a reply
 * quoting it said "This applies company-wide across all brands — <this
 * brand>, <two other brands> — pets are not allowed…" (in the sibling app).
 * Pau: only that app's own brand; this app gets the mirror image, only its own.
 *
 * NO BRAND IS NAMED HERE. This company's name is the brand config's
 * (`lib/brand` ACTIVE_BRAND); the other brands are the pattern the manual
 * block already leaves out (`full-manual-context.ts` EXCLUDED_BRAND). The step is code on the finished reply, the
 * last one of the turn — not a prompt line:
 *
 *   A LIST OF BRANDS THAT HOLDS THIS ONE   "across all brands — A, B, C" → "at A";
 *                                          "A, B and C" → "A".
 *   A LINE HEADED BY ANOTHER BRAND         "- **B** — …", "*B*" and the bullets under it: dropped whole.
 *   ANY OTHER SENTENCE THAT NAMES ONE      dropped whole.
 *
 * A QUOTATION IS NEVER REWORDED (POLICY_CITATION_CHECK: a quote must be
 * verbatim). A sentence or line holding a quote is kept whole or dropped
 * whole, so every quote that remains is still the manual's own text. Off, the
 * reply as built.
 */

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The pieces the rules read, built from a brand name and the other brands' pattern sources. */
export interface BrandWords {
  readonly own: string;
  readonly others: readonly string[];
}

/* The other brands are the pattern the manual block already leaves out (`full-manual-context.ts` EXCLUDED_BRAND). */
const DEFAULT_WORDS: BrandWords = { own: ACTIVE_BRAND.brandName, others: [EXCLUDED_BRAND.source] };

function patterns(words: BrandWords) {
  const own = escape(words.own).replace(/\\? /g, String.raw`\s+`);
  const other = `(?:${words.others.join("|")})`;
  const brand = `(?:\\*{1,2}|_)?(?:${own}|${other})(?:\\*{1,2}|_)?`;
  const sep = String.raw`\s*(?:,\s*(?:and\s+|&\s+)?|\s+and\s+|\s*&\s*|\s*\/\s*)`;
  return {
    ownName: words.own,
    own: new RegExp(`\\b${own}\\b`, "i"),
    other: new RegExp(`\\b${other}\\b`, "i"),
    /** "across all brands — A, B, C": the lead and the list. */
    acrossList: new RegExp(
      String.raw`\b(?:across|for|in)\s+(?:all|every)(?:\s+(?:of\s+)?(?:the|our))?\s+brands?\b(?:\s*\([^)]*\))?\s*[—–:-]\s*(${brand}(?:${sep}${brand})+)`,
      "gi",
    ),
    /** "A, B and C": a list of two or more brands. */
    list: new RegExp(`\\b${brand}(?:${sep}${brand})+`, "gi"),
    /** A line whose first words are another brand: "- **B** — …", "*B*", "B:". */
    otherHeaded: new RegExp(String.raw`^\s*(?:[-*•o]\s+|\d+\.\s+)?(?:\*{1,2}|_)?\s*${other}\b`, "i"),
  };
}

const QUOTE = /["“”]/;

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].length;
}

/** A line that is only a brand heading — "*B*", "**B:**", "B:" — whose block runs on under it. */
function isHeadingOnly(line: string, other: RegExp): boolean {
  const bare = line.replace(/^\s*(?:[-*•o]\s+|\d+\.\s+)?/, "").replace(/[*_:#]/g, "").trim();
  return other.test(bare) && bare.replace(other, "").trim() === "";
}

/** The text with only this company's brand named. Pure. */
export function ownBrandOnly(text: string, words: BrandWords = DEFAULT_WORDS): string {
  const p = patterns(words);
  if (!p.other.test(text)) return text;
  const out: string[] = [];
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (!p.other.test(line)) {
      out.push(line);
      continue;
    }
    if (p.otherHeaded.test(line)) {
      // Another brand's heading and the bullets under it go; a bullet of its own goes alone.
      if (isHeadingOnly(line, p.other)) {
        const indent = indentOf(line);
        while (at + 1 < lines.length && lines[at + 1]!.trim() !== "" && (indentOf(lines[at + 1]!) > indent || /^\s*[-*•o]\s/.test(lines[at + 1]!)) && !isHeadingOnly(lines[at + 1]!, p.own)) {
          at += 1;
        }
      }
      continue;
    }
    out.push(withinLine(line, p));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withinLine(line: string, p: ReturnType<typeof patterns>): string {
  const lead = /^\s*(?:[-*•o]\s+|\d+\.\s+)?/.exec(line)![0];
  const body = line.slice(lead.length);
  // A full stop (or one inside a closing quote) ends a sentence only before a space or the end ("[p.29]" does not).
  const sentences = body.match(/(?:[^.!?]|[.!?](?!["”’]?(?:\s|$)))+(?:[.!?]+["”’]?)?\s*/g) ?? [body];
  const kept = sentences
    .map((sentence) => {
      if (!p.other.test(sentence)) return sentence;
      if (QUOTE.test(sentence)) return "";
      let next = sentence.replace(p.acrossList, (whole, list: string) => (p.own.test(list) ? `at ${p.ownName}` : whole));
      next = next.replace(p.list, (list) => (p.own.test(list) ? p.ownName : list));
      return p.other.test(next) ? "" : next;
    })
    .join("")
    .trim();
  return kept ? `${lead}${kept}` : "";
}

/** OWN_BRAND_ONLY_ENABLED: the finished reply with only this company's brand named. Off: as built. */
export function withOwnBrandOnly(response: AskResponse): AskResponse {
  if (!ownBrandOnlyEnabled()) return response;
  const content = ownBrandOnly(response.content);
  return content === response.content ? response : { ...response, content };
}
