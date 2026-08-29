import type { BrandConfig } from "@/types";

/**
 * MULTI-BRAND READINESS
 * ---------------------------------------------------------------------------
 * Ask Sunny ships for Sun Tan City first. A second instance for Buff City Soap
 * is planned, driven by a different knowledge corpus and the Tokyo Green
 * identity.
 *
 * Everything brand-specific lives in a BrandConfig:
 *   - product / assistant naming used in copy
 *   - the wordmark
 *   - a map of semantic design tokens -> that brand's colour values
 *   - the knowledge scope id used to filter retrieval to one brand's corpus
 *
 * The app shell writes `paletteTokens` onto the root element as inline CSS
 * custom properties, which override the defaults in globals.css. Adding Buff
 * City Soap is therefore: add a config below, point ACTIVE_BRAND at it, seed
 * that brand's knowledge base. No component changes.
 */

export const STC_BRAND: BrandConfig = {
  id: "stc",
  brandName: "Sun Tan City",
  productName: "Ask Sunny",
  assistantName: "Sunny",
  operatorName: "JV & Associates",
  wordmark: { lead: "ASK", trail: "SUNNY" },
  tagline: "One place to run your salon",
  knowledgeScopeId: "stc-core",
  vocabulary: {
    salonNoun: "salon",
    salonNounPlural: "salons",
    dailyReportName: "Daily Stats",
  },
  // Empty = use the defaults already declared in globals.css.
  paletteTokens: {},
};

/**
 * Planned second instance. Not shipped in this phase — kept here as the
 * worked example of what a brand swap costs (a config object, nothing else).
 * Values are placeholders until Buff City Soap's official tokens are supplied.
 */
export const BCS_BRAND_DRAFT: BrandConfig = {
  id: "bcs",
  brandName: "Buff City Soap",
  productName: "Ask Sunny",
  assistantName: "Sunny",
  operatorName: "JV & Associates",
  wordmark: { lead: "ASK", trail: "SUNNY" },
  tagline: "One place to run your shop",
  knowledgeScopeId: "bcs-core",
  vocabulary: {
    salonNoun: "shop",
    salonNounPlural: "shops",
    dailyReportName: "Daily Stats",
  },
  paletteTokens: {
    "--background": "#f7faf9",
    "--surface-muted": "#eef5f3",
    "--sidebar": "#f1f7f5",
    "--sidebar-active": "#dbeeea",
    "--primary": "#2f6d67",
    "--primary-hover": "#265953",
    "--primary-soft": "#dbeeea",
    "--primary-soft-foreground": "#23544f",
    "--accent": "#5cc4b8",
    "--accent-hover": "#49a89d",
    "--accent-soft": "#e2f5f2",
    "--accent-soft-foreground": "#26635c",
    "--ring": "#2f6d67",
  },
};

/** The brand this build ships. Swap to BCS_BRAND_DRAFT for the BCS instance. */
export const ACTIVE_BRAND: BrandConfig = STC_BRAND;

/** Turns a BrandConfig palette map into an inline style object. */
export function brandStyle(brand: BrandConfig): Record<string, string> {
  return { ...brand.paletteTokens };
}
