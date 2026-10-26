/**
 * This company's knowledge settings that name brands. The mechanism that
 * reads them is generic (`lib/knowledge/excerpt-brand-filter.ts`); the names
 * are company content and live here, beside `ACTIVE_BRAND`.
 */

/**
 * The sibling company's brand, as a source excerpt must never show it
 * (EXCERPT_BRAND_FILTER_ENABLED). Regular expression SOURCES. Crunch is not
 * listed: it is a JB & Associates brand, and its sections are already left
 * out of the full manual.
 */
export const EXCERPT_HIDDEN_BRANDS: readonly string[] = [String.raw`Buff\s+City(?:\s+Soap)?`, String.raw`BCS`];
