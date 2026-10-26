import { STC_BRAND } from "@/lib/brand";
import { REPLY_GUARD_WORDS } from "@/lib/brand/other-brands";
import { brandReplyGuardEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A REPLY SPEAKS FOR THIS COMPANY ONLY (BRAND_REPLY_GUARD_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA, 25 Oct 2026, testers G21, U1, U6): the
 * model's prose carried another company's name from the JBA manual's
 * company-wide text: an answer that "applies across all brands (…)", a list
 * of each brand's own system, "open the salon/store". The manual covers
 * several brands, so the same can happen here with the sibling company.
 *
 * At answer time, sentence by sentence:
 *
 *   a parenthetical or a list item that names the other company is taken
 *   out, and what is left is kept when it no longer names it;
 *   a sentence that is about the other company and nothing else is taken out;
 *   "salon/store" is this company's word;
 *   a quoted phrase and a manual title ("… Policy", "… Manual") are never
 *   rewritten;
 *   a reply is never emptied: if nothing of it is left, a short line says so
 *   in this company's name.
 *
 * The other company's words, and this company's location word, are company
 * configuration (`lib/brand/other-brands.ts`); this module is the same in
 * both apps. The manual's title ("JBA Policy Manual") and its page citations
 * are never touched. Off, the reply as written.
 */

const WORDS = REPLY_GUARD_WORDS;

function anyOf(sources: readonly string[]): string {
  return sources.map((source) => `(?:${source})`).join("|");
}

/** A name that marks a piece of a reply as about another company. */
const OTHER_BRAND = new RegExp(String.raw`\b(?:${anyOf(WORDS.otherCompany)})\b`, "i");

/** "for any brand under <the operating group>" says "here". Null when the company lists no group. */
const ANY_BRAND =
  WORDS.operatingGroup.length > 0
    ? new RegExp(
        String.raw`\b(?:for|at|across)\s+(?:any|every|all)\s+(?:brands?|locations?)\s+(?:under|of|in)\s+(?:the\s+)?(?:${anyOf(WORDS.operatingGroup)})(?:\s+family)?\b`,
        "gi",
      )
    : null;

const LOCATION = WORDS.location.own;
const LOCATIONS = WORDS.location.ownPlural;

/** The other company's title inside a slash list: "A/B/C". */
function withoutSlashedTitles(sentence: string): string {
  if (WORDS.otherTitles.length === 0) return sentence;
  const title = `(?:${anyOf(WORDS.otherTitles)})`;
  return sentence
    .replace(new RegExp(String.raw`\s*/\s*${title}\b`, "g"), "")
    .replace(new RegExp(String.raw`\b${title}\s*/\s*`, "g"), "");
}

/** Parentheticals that name another brand. */
function withoutBrandParentheticals(sentence: string): string {
  return sentence.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => (OTHER_BRAND.test(inner) ? "" : whole));
}

/** List items that name another brand: "MyGlow for <this brand>, MyGlow for <another>, or Woven for <a third>". */
function withoutBrandListItems(sentence: string): string {
  const parts = sentence.split(/(,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)/);
  if (parts.length < 3) return sentence;
  const items: { sep: string; text: string }[] = [];
  for (let index = 0; index < parts.length; index += 2) items.push({ sep: index === 0 ? "" : parts[index - 1]!, text: parts[index]! });
  const kept = items.filter((item) => !OTHER_BRAND.test(item.text));
  if (kept.length === items.length || kept.length === 0) return sentence;
  const last = items[items.length - 1]!;
  // A dropped last item keeps the citations and the stop it carried: "… or Woven for Crunch [p.37]."
  const tail = kept.at(-1) === last ? "" : (/((?:\s*\[(?:p|S)\.?\s*\d+\])*)\s*([.!?:;]?)\s*$/.exec(last.text) ?? ["", "", ""]).slice(1).join("");
  return kept
    .map((item, index) => (index === 0 ? item.text : `${item.sep}${item.text}`))
    .join("")
    .concat(tail);
}

/**
 * Quoted text and manual titles are kept as written: `"Salon/Store Opening"`,
 * "Salon Director Manual". Each is swapped for a placeholder while the
 * location word is changed, then put back.
 */
const KEPT_AS_WRITTEN =
  /"[^"\n]*"|“[^”\n]*”|\b(?:[A-Z][\w&'/-]*\s+){0,5}(?:Policy|Policies|Manual|Handbook|Guide)\b(?:\s+\[p\.\d+\])?/g;

/** This company's location word where a reply wrote both ("A/B"), or the other company's alone when the company says so. */
function withLocationWord(text: string): string {
  const kept: string[] = [];
  const masked = text.replace(KEPT_AS_WRITTEN, (match) => `\u0000${kept.push(match) - 1}\u0000`);
  const own = WORDS.location.own;
  const other = WORDS.location.other;
  const pair = new RegExp(String.raw`\b${own}s?\s*\/\s*${other}s?\b|\b${other}s?\s*\/\s*${own}s?\b`, "gi");
  let swapped = masked.replace(pair, (match) => (/s\b/i.test(match.split("/")[0]!.trim()) ? LOCATIONS : LOCATION));
  if (WORDS.replaceOtherLocationAlone) {
    swapped = swapped
      .replace(new RegExp(String.raw`\b(${other.charAt(0).toUpperCase()}|${other.charAt(0)})${other.slice(1)}s\b`, "g"), (_m, first: string) =>
        first === first.toUpperCase() ? cap(LOCATIONS) : LOCATIONS,
      )
      .replace(new RegExp(String.raw`\b(${other.charAt(0).toUpperCase()}|${other.charAt(0)})${other.slice(1)}\b`, "g"), (_m, first: string) =>
        first === first.toUpperCase() ? cap(LOCATION) : LOCATION,
      );
  }
  return swapped.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => kept[Number(index)]!);
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** One sentence, with another brand taken out of it, or null when nothing of it is left. */
function guardSentence(sentence: string): string | null {
  const anyBrand = ANY_BRAND !== null && new RegExp(ANY_BRAND.source, "i").test(sentence);
  if (!OTHER_BRAND.test(sentence) && !anyBrand) return sentence;
  let text = ANY_BRAND ? sentence.replace(ANY_BRAND, `at ${STC_BRAND.brandName}`) : sentence;
  if (!OTHER_BRAND.test(text)) return text;
  text = withoutSlashedTitles(text);
  if (!OTHER_BRAND.test(text)) return text;
  text = withoutBrandParentheticals(text);
  if (!OTHER_BRAND.test(text)) return text;
  text = withoutBrandListItems(text);
  return OTHER_BRAND.test(text) ? null : text;
}

/** Said when nothing of a reply is left: this company's name only. */
export const NOTHING_LEFT = `That one isn't part of the ${STC_BRAND.brandName} policy as far as I can see. Ask me about ${STC_BRAND.brandName} and I'll check the manual.`;

/** The reply in this company's words, never empty. Off, as written. */
export function withoutOtherBrands(content: string): string {
  if (!brandReplyGuardEnabled() || !content) return content;
  const lines = content.split("\n").map((line) => {
    const pieces = line.split(/(?<=[.!?])(\s+)/);
    const out: string[] = [];
    let dropped = false;
    for (let index = 0; index < pieces.length; index += 2) {
      const sentence = pieces[index]!;
      const space = pieces[index + 1] ?? "";
      const kept = guardSentence(sentence);
      if (kept === null || kept.trim() === "" || /^\s*[-*•]\s*$/.test(kept) || /^\s*\d+\.\s*$/.test(kept)) {
        dropped = true;
        continue;
      }
      out.push(kept, space);
    }
    const joined = out.join("").trimEnd();
    return dropped && joined.trim() === "" ? null : joined;
  });
  const guarded = withLocationWord(lines.filter((line): line is string => line !== null).join("\n")).replace(/\n{3,}/g, "\n\n");
  // What is left must still say something: not only a citation, a label or punctuation.
  const words = guarded.replace(/\[(?:p|S)\.?\s*\d+\]/g, " ").replace(/[^A-Za-z]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length < 3 ? NOTHING_LEFT : guarded;
}
