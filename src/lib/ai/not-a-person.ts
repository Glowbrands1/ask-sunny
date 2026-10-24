import { PRODUCTION_SALONS } from "@/data/salons";
import { OFFICIAL_POLICY_MANUAL } from "@/lib/forms/official-policy-manual";

/**
 * A state abbreviation or the policy manual's own title, read from the roster
 * and the manual — never a list of words kept here.
 */

const TITLE_WORDS = new Set(
  OFFICIAL_POLICY_MANUAL.fallbackTitles.flatMap((title) =>
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  ),
);

/** The whole candidate is a roster state's abbreviation: "NE", not "Mo Smith". */
export function isRosterStateName(name: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  return PRODUCTION_SALONS.some((salon) => salon.state.toLowerCase() === words[0]);
}

/**
 * Every word is a word of the official manual's title: "JBA Manual",
 * "JBA Policy Manual". A single word is still somebody's name.
 */
export function isDocumentName(name: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2 || TITLE_WORDS.size === 0) return false;
  return words.every((word) => TITLE_WORDS.has(word));
}
