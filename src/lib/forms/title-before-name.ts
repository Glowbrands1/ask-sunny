import { PRODUCTION_SALONS } from "@/data/salons";
import { titleBeforeNameEnabled } from "@/lib/config/chat-quality-flags";

import { JOB_TITLES } from "./proposal";

/**
 * ============================================================================
 * A JOB TITLE BEFORE THE NAME IS NOT PART OF IT (TITLE_BEFORE_NAME_ENABLED; ported from Ask Bubbles, 11 Nov 2026)
 * ============================================================================
 *
 * QA's Ask Bubbles 17h live test: "Corrective action for Team Member <name>" gave no card. Here the same happens with
 * this app's titles ("Corrective action for Tanning Consultant <name>", "… for Salon Director <name>"): the words after
 * "for" count as a name only when the first could be one. A job title in front of the name says who the person is,
 * not what they are called. A state code is never read as one ("for SD Sioux Falls" names a place), and a title with
 * no word after it names nobody.
 */
const STATE_CODES = new Set(PRODUCTION_SALONS.map((salon) => salon.state.toLowerCase()));

function isWholeTitle(phrase: string): boolean {
  const bare = phrase.replace(/[.,;:]+$/, "").trim();
  if (bare === "" || STATE_CODES.has(bare.toLowerCase())) return false;
  return JOB_TITLES.some((entry) => bare.replace(new RegExp(entry.pattern.source, "gi"), "").trim() === "");
}

/** How many of the leading words are a job title (0 when none, or the flag off, or no word follows it). */
export function leadingTitleLength(words: readonly string[]): number {
  if (!titleBeforeNameEnabled()) return 0;
  for (let length = Math.min(4, words.length - 1); length >= 1; length -= 1) {
    if (isWholeTitle(words.slice(0, length).join(" "))) return length;
  }
  return 0;
}

/** "Tanning Consultant Wren Tallis" → "Wren Tallis"; anything else, or the flag off, as typed. */
export function withoutLeadingTitle(name: string): string {
  const words = name.trim().split(/\s+/);
  const skip = leadingTitleLength(words);
  return skip === 0 ? name : words.slice(skip).join(" ");
}
