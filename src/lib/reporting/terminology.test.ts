import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * ============================================================================
 * DEPRECATED WORDING STAYS DEPRECATED
 * ============================================================================
 *
 * Four phrases the 14 September review asked to be removed, each with its own
 * reason. They are easy to reintroduce — a copied component, a new report tab,
 * a prompt someone pastes — and impossible to notice in review, so the guard is
 * a test rather than a convention.
 *
 * COMMENTS ARE EXEMPT, and deliberately. Several of these modules explain what
 * the old wording was and why it went; a guard that forbade the explanation
 * would delete the reasoning along with the phrase.
 */

const SRC = join(process.cwd(), "src");

/** Strips comments, so an explanation of a removed phrase is not an offence. */
function visibleCopy(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    // Tests carry the phrases they are asserting against.
    if (path.includes(".test.")) continue;
    if ([".ts", ".tsx"].includes(extname(path))) found.push(path);
  }
  return found;
}

const FILES = sourceFiles(SRC);

/** Files where a phrase is legitimate, with the reason it is. */
const ALLOWED: Record<string, { path: string; why: string }[]> = {
  utilisation: [
    {
      path: "lib/reporting/read/family-routing.ts",
      why: "a routing keyword matching what a manager TYPES, not what the product shows",
    },
  ],
};

function offenders(phrase: string, exact?: RegExp): string[] {
  const allowed = ALLOWED[phrase] ?? [];
  const out: string[] = [];
  for (const file of FILES) {
    if (allowed.some((entry) => file.endsWith(entry.path))) continue;
    const text = visibleCopy(readFileSync(file, "utf8"));
    const hit = exact ? exact.test(text) : text.toLowerCase().includes(phrase);
    if (hit) out.push(file.slice(SRC.length + 1));
  }
  return out;
}

describe("wording the review asked to be removed", () => {
  it("has no 'Recipient slice' anywhere a reader could see it", () => {
    // "That is internal language and will not mean anything to a Salon
    // Director. '15 salons included' communicates the same thing clearly."
    expect(offenders("recipient slice")).toEqual([]);
  });

  it("has no 'Training that finds you'", () => {
    // "We are not hosting training within the site."
    expect(offenders("training that finds you")).toEqual([]);
  });

  it("spells Utilization the American way in every user-facing string", () => {
    // "'Utilisation' is spelled using the British version in two places."
    expect(offenders("utilisation")).toEqual([]);
  });

  it("does not label a freshness stamp 'Loaded'", () => {
    /*
     * "'Loaded' reads like a system event, while 'Refreshed' tells a manager
     * how current the information is."
     *
     * Matched as the LABEL — `Loaded ` followed by a value, or a `Loaded`
     * heading — rather than as the word, which appears legitimately in
     * "Loaded periods:" when listing which periods exist and in ordinary
     * sentences about loading.
     */
    expect(offenders("", /\bLoaded \$\{|>\s*Loaded\s+\{|"Loaded "/)).toEqual([]);
  });
});

describe("'Estate' is not the word the field teams use", () => {
  /*
   * "'Estate' is used throughout the site to describe our group of salons. That
   * is not language our field teams use. Please change it to 'region' or 'your
   * salons,' depending on the context."
   *
   * THE INTERNAL VOCABULARY IS UNTOUCHED, and that is the review's own
   * instruction read carefully: `estateSummaryKey`, `estatePerBed` and the
   * `estate-scope-cards` module are identifiers and file names, not copy.
   * Renaming them would churn the schema, the URL parameters and the migration
   * history for no reader's benefit.
   */
  const IDENTIFIER = /\b(estateSummary|estateScope|estatePerBed|estateConversion|estateAverage|estateTans|EstateScopeCards|estate-scope|estate=\$)/;

  /*
   * THE RULE THAT FORBIDS THE WORD HAS TO NAME IT. Three prompt strings tell
   * the model not to use "estate" in an answer; they are the enforcement, not a
   * violation, and a guard that flagged them would delete the enforcement.
   */
  const FORBIDS_IT = /Do not use the word|DO NOT USE THE WORD/;

  it("has no user-facing string containing it", () => {
    const out: string[] = [];
    for (const file of FILES) {
      const text = visibleCopy(readFileSync(file, "utf8"));
      // Quoted strings and template literals only — the copy, not the code.
      const strings = text.match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      for (const literal of strings) {
        /*
         * A WORD BOUNDARY, because `restate` contains `estate`. Two
         * form-drafting prompts say "do not restate it in a field", and
         * flagging those would be the guard misreading English.
         */
        if (!/\bestates?\b/i.test(literal)) continue;
        if (IDENTIFIER.test(literal)) continue;
        if (FORBIDS_IT.test(literal)) continue;
        out.push(`${file.slice(SRC.length + 1)}: ${literal.slice(0, 80)}`);
      }
    }
    expect(out).toEqual([]);
  });
});
