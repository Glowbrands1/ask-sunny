import { afterEach, describe, expect, it, vi } from "vitest";

import { incidentDates } from "@/lib/forms/incident-dates";
import { statedPriorActions } from "@/lib/forms/prior-actions";

/**
 * ============================================================================
 * QA, 26 OCT 2026 — PRIOR ACTIONS TYPED WITH NO COMMA BETWEEN THEM
 * ============================================================================
 *
 * The manager's words, as QA reported them:
 *
 *   "prior coaching verbal 6/25 written 7/28 no deduct"
 *
 * With PRIOR_ACTIONS_PARSE_ENABLED (on in production) the second prior action
 * read "Written warning — verbal 6/25 — 07/28/2026": with no comma, 7/28 was
 * no list item, and the labelled-step reader took every word back to "prior
 * coaching" as its topic. "prior coaching: verbal 6/25, written 7/28" read
 * cleanly. PRIOR_ACTIONS_NO_COMMA_ENABLED lets a step item set off by spaces
 * alone continue the list, each item holding only its own words.
 *
 * Every case runs all lowercase, in sentence case, and in sentence case with
 * names and levels Capitalized. Names are invented ("Test Employee", "Test
 * Salon"). Year-less dates take TODAY's year, passed in as the other
 * year-less suites do (`prior-actions-yearless-oct25.test.ts`).
 */

const TODAY = "2026-10-26";

const PRIORS = ["Verbal warning — 06/25/2026", "Written warning — 07/28/2026"];

/** All lowercase; sentence case; sentence case with names and levels Capitalized. */
function variants(text: string): string[] {
  const lower = text.toLowerCase();
  const sentence = lower.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
  const capitalized = sentence.replace(
    /\b(verbal|written|final|coaching|test employee|test salon)\b/g,
    (word) => word.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  );
  return [...new Set([lower, sentence, capitalized])];
}

function flags(parse: boolean, noComma: boolean): void {
  vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", parse ? "1" : "");
  vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", noComma ? "1" : "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const FLAG_ON: { text: string; priors: string[]; incidents: string[] }[] = [
  { text: "prior coaching verbal 6/25 written 7/28 no deduct", priors: PRIORS, incidents: [] },
  { text: "prior coaching verbal 6/25/2026 written 7/28/2026", priors: PRIORS, incidents: [] },
  { text: "previous coaching verbal 6/25 written 7/28", priors: PRIORS, incidents: [] },
  {
    text: "prior verbal 9/1 written 9/15",
    priors: ["Verbal warning — 09/01/2026", "Written warning — 09/15/2026"],
    incidents: [],
  },
  { text: "no prior", priors: [], incidents: [] },
  // Neighbours that already read cleanly and must keep doing so.
  { text: "prior coaching: verbal 6/25, written 7/28", priors: PRIORS, incidents: [] },
  {
    text: "previous coaching. she was late (10/20/2026) and left early (10/22/2026)",
    priors: [],
    incidents: ["2026-10-20", "2026-10-22"],
  },
  {
    text: "create a written ca for Test Employee at Test Salon, late to open 10/20/2026. prior coaching verbal 6/25 written 7/28 no deduct",
    priors: PRIORS,
    incidents: ["2026-10-20"],
  },
];

describe("PRIOR_ACTIONS_NO_COMMA_ENABLED on (with PRIOR_ACTIONS_PARSE_ENABLED, as in production)", () => {
  for (const { text, priors, incidents } of FLAG_ON) {
    for (const variant of variants(text)) {
      it(`"${variant}"`, () => {
        flags(true, true);
        expect(statedPriorActions(variant, TODAY)).toEqual(priors);
        expect(incidentDates(variant, TODAY)).toEqual(incidents);
      });
    }
  }
});

describe("PRIOR_ACTIONS_NO_COMMA_ENABLED off: today's output, pinned", () => {
  // Pinned on purpose: this is the defect QA reported, the second line keeping
  // the first item's words. The new flag off must leave it byte for byte.
  const GARBLED: [string, string[]][] = [
    ["prior coaching verbal 6/25 written 7/28 no deduct", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"]],
    ["prior coaching verbal 6/25/2026 written 7/28/2026", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25/2026 — 07/28/2026"]],
    ["previous coaching verbal 6/25 written 7/28", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"]],
    ["prior verbal 9/1 written 9/15", ["Verbal warning — 09/01/2026", "Written warning — 9/1 — 09/15/2026"]],
    [
      "create a written ca for Test Employee at Test Salon, late to open 10/20/2026. prior coaching verbal 6/25 written 7/28 no deduct",
      ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"],
    ],
  ];
  for (const [text, priors] of GARBLED) {
    it(`"${text}" with PRIOR_ACTIONS_PARSE_ENABLED alone`, () => {
      flags(true, false);
      expect(statedPriorActions(text, TODAY)).toEqual(priors);
    });
  }

  it("Capitalized levels keep the manager's casing in the garbled line", () => {
    flags(true, false);
    expect(statedPriorActions("Prior coaching Verbal 6/25 Written 7/28 no deduct", TODAY)).toEqual([
      "Verbal warning — 06/25/2026",
      "Written warning — Verbal 6/25 — 07/28/2026",
    ]);
  });

  it("the new flag without PRIOR_ACTIONS_PARSE_ENABLED changes nothing", () => {
    const text = "prior coaching verbal 6/25 written 7/28 no deduct";
    flags(false, false);
    const before = statedPriorActions(text, TODAY);
    expect(before).toEqual(["Verbal warning — signed 06/25/2026", "Written warning — verbal 6/25 — signed 07/28/2026"]);
    flags(false, true);
    expect(statedPriorActions(text, TODAY)).toEqual(before);
    expect(statedPriorActions("prior verbal 9/1 written 9/15", TODAY)).toEqual([]);
    expect(incidentDates("prior verbal 9/1 written 9/15", TODAY)).toEqual(["2026-09-01", "2026-09-15"]);
  });
});
