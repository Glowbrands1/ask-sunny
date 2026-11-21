import { appConfig } from "./app-config";

/**
 * ============================================================================
 * THE POLICY FITS WHAT HAPPENED (QA, the 266 audit by Runner 2, train 4 on main 6d0b4ab1, 16 Nov 2026)
 * ============================================================================
 *
 * Two of the rules book's policy lines, as facts propose_form checks (code refuses, the model chooses again):
 *
 * - DRESS CODE (c261, c263): "a coat or the wrong top during a shift is dress code". When the manager's words for the
 *   offense name dress code ("out of dresscode"), or an item of clothing worn on shift ("wearing her coat during her
 *   shift", "a black crewneck on during her shift"), the fit is the manual's own Dress Code headings, read from the
 *   manual's section titles (never a page or a title kept here). The clothing words are the one list: the manual names
 *   its sections (Shirts, Pants, Shoes) but not the coats and crewnecks managers write about.
 * - MUST SEE BEHAVIORS (c207): "Other — Must See Behaviors" only when the request says MSB or must see behaviors (Pau's
 *   ruling, 16 Nov 2026). Missed numbers or under-performance without those words is the Standards of Conduct.
 *
 * Only the manager's words are read, never the model's account.
 */

/** "dress code", "dresscode", "dress-code": the words of the manual's Dress Code headings. */
const DRESS_CODE = /\bdress[\s-]*code\b/i;

/** The manager takes it off ("not dress code", "it isn't a dress code thing"): never a reason to refuse. */
const NOT_DRESS_CODE = /\b(?:not|isn'?t|is\s+not|no)\s+(?:a\s+|the\s+)?dress[\s-]*code\b(?!\s+(?:violation|issue|infraction))/i;

/** Clothing worn at work. "top" alone is left out ("the top seller"); "crop top" and "tank top" are clothing. */
const CLOTHING =
  String.raw`(?:coats?|jackets?|hoodies?|hoody|sweat\s?shirts?|sweaters?|cardigans?|crew\s?necks?|(?:tank|crop)\s+tops?|t-?shirts?|shirts?|uniforms?|pants|jeans|leggings|shorts|skirts?|shoes|sneakers|sandals|slides|flip[\s-]?flops|hats?|beanies?|caps?|name\s?tags?)`;
const WORN = new RegExp(String.raw`\b(?:wear(?:s|ing)?|wore|worn|ha(?:d|s|ve|ving)|put\s+on|took\s+off|take\s+off)\b[^.!?\n]{0,40}?\b${CLOTHING}\b|\b${CLOTHING}\b[^.!?\n]{0,20}?\bon\b`, "i");
const ON_SHIFT = /\b(?:shifts?|at\s+work|working|while\s+work\w*|on\s+the\s+(?:floor|clock)|during\s+(?:work|the\s+day|business\s+hours))\b/i;

/** Whether one sentence of the manager's words is clothing worn on shift. */
function clothingOnShift(sentence: string): boolean {
  return WORN.test(sentence) && ON_SHIFT.test(sentence);
}

/**
 * The manual's Dress Code headings when the manager's words describe a dress-code offense, else null. `headings` are the
 * manual's section titles as the manual prints them.
 */
export function dressCodeFit(managerWords: string, headings: readonly string[]): string[] | null {
  const fits = headings.filter((heading) => DRESS_CODE.test(heading));
  if (fits.length === 0 || NOT_DRESS_CODE.test(managerWords)) return null;
  const sentences = managerWords.split(/(?<=[.!?])\s+|\n+/);
  const said = DRESS_CODE.test(managerWords) || sentences.some(clothingOnShift);
  return said ? fits : null;
}

/** Whether a policy the model gave is Must See Behaviors ("Other — Must See Behaviors", "Other — MSB"). */
export function citesMustSee(policy: string): boolean {
  return appConfig().policyGuards.saidOnlyOther?.cited.test(policy) ?? false;
}

/** Whether the manager's words say MSB or must see behaviors. */
export function saysMustSee(managerWords: string): boolean {
  return appConfig().policyGuards.saidOnlyOther?.said.test(managerWords) ?? false;
}

/** The looser naming the guards count as the manager naming it ("msb", "must see behaviors"). */
export function namesMustSee(managerWords: string): boolean {
  return appConfig().policyGuards.saidOnlyOther?.named.test(managerWords) ?? false;
}
