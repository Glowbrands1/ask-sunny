import { STC_BRAND } from "@/lib/brand";
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
 * Only the sibling company is another brand here. JB & Associates is this
 * app's operator and the manual's tanning sections are shared with Crunch, so
 * neither is taken out. The manual's title ("JBA Policy Manual") and its page
 * citations are never touched. Off, the reply as written.
 */

const OTHER_BRAND = /\b(?:Buff\s+City(?:\s+Soap)?|BCS)\b/i;

const LOCATION = STC_BRAND.vocabulary.salonNoun;
const LOCATIONS = STC_BRAND.vocabulary.salonNounPlural;

/** Parentheticals that name another brand. */
function withoutBrandParentheticals(sentence: string): string {
  return sentence.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => (OTHER_BRAND.test(inner) ? "" : whole));
}

/** List items that name another brand: "MyGlow for Buff City Soap, MyGlow for Sun Tan City, or Woven for Crunch". */
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

/** This company's word where a reply wrote both: "salon/store". */
function withLocationWord(text: string): string {
  const kept: string[] = [];
  const masked = text.replace(KEPT_AS_WRITTEN, (match) => `\u0000${kept.push(match) - 1}\u0000`);
  const swapped = masked.replace(/\bsalons?\s*\/\s*stores?\b|\bstores?\s*\/\s*salons?\b/gi, (match) =>
    /s\b/i.test(match.split("/")[0]!.trim()) ? LOCATIONS : LOCATION,
  );
  return swapped.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => kept[Number(index)]!);
}

/** One sentence, with another brand taken out of it, or null when nothing of it is left. */
function guardSentence(sentence: string): string | null {
  if (!OTHER_BRAND.test(sentence)) return sentence;
  let text = withoutBrandParentheticals(sentence);
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
