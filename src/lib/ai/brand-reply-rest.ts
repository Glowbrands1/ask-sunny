import { brandReplyGuardEnabled } from "@/lib/config/chat-quality-flags";
import { ACTIVE_BRAND } from "@/lib/brand";

import { EXCLUDED_BRAND } from "./full-manual-context";

/**
 * ============================================================================
 * WHAT THE OWN-BRAND STEP STILL LEFT, OR DROPPED WITH ITS RULE (BRAND_REPLY_GUARD_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA's October triage of its #198, 10 Nov 2026). Checked here on main with production's
 * flags (OWN_BRAND_ONLY on): the same reply shapes leak the same way —
 *
 *   "… applies across all brands (<this brand>, <another>, <another>, JB & Associates office) [p.14]."
 *        kept "(<this brand>, JB & Associates office)".
 *   "Submit availability changes … in MyGlow for <this brand>, MyGlow for <another>, or Woven for <another> [p.37]."
 *        dropped whole, this company's system with it.
 *   "IF YOU CAN'T OPEN THE SALON/STORE ON TIME …"                 kept "SALON/STORE".
 *
 * On, before the own-brand step (`own-brand-only.ts`) reads the reply:
 *
 *   A BRACKETED LIST OF BRANDS     that holds this one (the JBA office among them or not) goes.
 *   "<X> FOR <this brand>, <Y> FOR <another>, or <Z> FOR <another>"   keeps "<X> for <this brand>".
 *   "SALON/STORE"                  becomes "salon", in the case it was written in.
 *
 * Unlike the sibling app, "for any brand under JB & Associates" is left as written: JB & Associates is this company.
 * Brand names come from the brand config and the manual reader's pattern; none is written here. Pure; off, the text
 * as given.
 */

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The other brands, as `own-brand-only.ts` reads them: the manual reader's pattern without its office alternatives. */
const OTHER_BRANDS = EXCLUDED_BRAND.source
  .replace(/^\\b\(\?:|\)\\b$/g, "")
  .split("|")
  .filter((alternative) => !/\boffice\b/.test(alternative));

const OWN = escape(ACTIVE_BRAND.brandName).replace(/\\? /g, String.raw`\s+`);
const OTHER = `(?:${OTHER_BRANDS.join("|")})`;
const OFFICE = String.raw`(?:JB\s*(?:&|and)\s*Associates|JBA)\s+office`;
const ITEM = `(?:${OWN}|${OTHER}|${OFFICE})`;
const SEP = String.raw`\s*(?:,\s*(?:and\s+|or\s+|&\s+)?|\s+and\s+|\s+or\s+|\s*&\s*|\s*\/\s*)`;

const BRACKETED = new RegExp(String.raw`\s*\(\s*(${ITEM}(?:${SEP}${ITEM})+)\s*\)`, "gi");
const FOR_OWN_THEN_OTHERS = new RegExp(
  String.raw`(\b[\w'’-]+(?:\s+[\w'’-]+){0,3}\s+for\s+${OWN})((?:\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+)[\w'’-]+(?:\s+[\w'’-]+){0,3}\s+for\s+${OTHER})+`,
  "gi",
);
const SALON_STORE = /\bsalon\s*\/\s*store\b/gi;

function salonInCase(written: string): string {
  if (written === written.toUpperCase()) return "SALON";
  return /^S/.test(written) ? "Salon" : "salon";
}

/** The reply with the leftovers above rewritten. Pure. */
export function brandReplyRest(text: string): string {
  return text
    .replace(BRACKETED, (whole, list: string) => (new RegExp(`\\b${OWN}\\b`, "i").test(list) ? "" : whole))
    .replace(FOR_OWN_THEN_OTHERS, (_whole, kept: string) => kept)
    .replace(SALON_STORE, salonInCase);
}

/** BRAND_REPLY_GUARD_ENABLED: `brandReplyRest`, or the text as given when off. */
export function withBrandReplyRest(text: string): string {
  return brandReplyGuardEnabled() ? brandReplyRest(text) : text;
}
