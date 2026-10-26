import { STC_BRAND } from "./index";

/**
 * The words a reply must not use for this company (BRAND_REPLY_GUARD_ENABLED).
 * Company content: the mechanism that reads them is generic
 * (`lib/ai/brand-reply-guard.ts`). Regular expression SOURCES.
 */
export interface ReplyGuardWords {
  /** Names that mark a sentence, list item or parenthetical as about another company. */
  readonly otherCompany: readonly string[];
  /** "for any brand under <group>": the group names that phrase is rewritten for. */
  readonly operatingGroup: readonly string[];
  /** The other company's titles, taken out of a slash list ("A/B/C"). */
  readonly otherTitles: readonly string[];
  /** This company's location word, and the other company's. */
  readonly location: { readonly own: string; readonly ownPlural: string; readonly other: string };
  /** Whether the other company's location word is replaced on its own too, or only beside this one ("salon/store"). */
  readonly replaceOtherLocationAlone: boolean;
}

/**
 * Only the sibling company is another brand here. JB & Associates is this
 * app's operator and the manual's tanning sections are shared with Crunch, so
 * neither is listed. "store" is an ordinary word here, so only "salon/store"
 * is rewritten.
 */
export const REPLY_GUARD_WORDS: ReplyGuardWords = {
  otherCompany: [String.raw`Buff\s+City(?:\s+Soap)?`, String.raw`BCS`],
  operatingGroup: [],
  otherTitles: [],
  location: { own: STC_BRAND.vocabulary.salonNoun, ownPlural: STC_BRAND.vocabulary.salonNounPlural, other: "store" },
  replaceOtherLocationAlone: false,
};
