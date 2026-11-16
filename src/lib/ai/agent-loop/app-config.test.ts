import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { appConfig, setAppConfigForTests, SUNNY_CONFIG, type AppConfig } from "./app-config";
import { agentLoopRules, agentLoopSystem } from "./prompt";
import { agentLoopTools } from "./run";
import { rulesBookText } from "./rules-book";

/**
 * PR 5 (app config): the loop's words belong to one file. Sunny's own text must stay byte-for-byte what it was
 * before the config existed (the fixtures were written from the code at main 8f7039c), and a second app's config
 * must change every word that names the app, its place word, its staff system and its form keys.
 *
 * The fixtures were updated on purpose on 15 Nov 2026 for one line: batch K (#1021, merged alongside this config)
 * added the rule 'Say a form or card is "ready" only when propose_form's card.status is "ready" …' to the prompt and
 * the rules book. That line names no app, place, staff system or form key, so it reads the same under every config;
 * nothing else in either text changed.
 *
 * Updated on purpose on 16 Nov 2026 (fix batch item 4): the two "Did you mean" lines in "Who the form is for" became one
 * consistent instruction (a yes or the full name typed back is a yes; confirmed_by_manager). Both lines name no app,
 * place, staff system or form key; nothing else in either text changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 1, an exit card nobody asked for): the Which form exit line now
 * asks for exit_evidence's kind, and one line was added for a resignation told with no ask. Both read the same under
 * every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 7, a bare "yes" set payroll): one Card replies line was added for
 * payroll_answer_unclear. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 2, "final warning", Pau's ruling): one Card replies line was added
 * for level_not_named. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (the retry guard, QA): one Card replies line was added for stop_retrying. It reads
 * the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (never guess, QA): a Replies line (never guess a pronoun) and a Which form line
 * (pasted text with no ask gets one question) were added, and the termination-offense line now says "the manager tells
 * in their own words". All read the same under every config; nothing else changed. The same day (Pau): the pronoun line
 * became "the employee by first name every time" (full names when two share a first name), and title_differs' template
 * says <first name> instead of <them>.
 */

const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

/** A made-up app: no word of it is Sunny's. */
const FAKE: AppConfig = {
  ...SUNNY_CONFIG,
  appName: "Zippo",
  brandName: "Quartz Cafe",
  locationWord: "kiosk",
  locationWordPlural: "kiosks",
  staffSystem: "Rotaplan",
  formKeys: { exit: "qc-leaving", corrective: "qc-warn", coaching: "qc-coach", followUpCoaching: "qc-follow" },
};

afterEach(() => setAppConfigForTests());

describe("app config: Sunny's text is unchanged", () => {
  it("the rules book is byte-identical", () => {
    expect(appConfig()).toBe(SUNNY_CONFIG);
    expect(rulesBookText()).toBe(fixture("sunny-rules-book.txt"));
  });

  it("the system prompt is byte-identical", () => {
    expect(agentLoopRules()).toBe(fixture("sunny-system-rules.txt"));
  });

  it("Sunny's config holds the values the loop used as literals", () => {
    expect(SUNNY_CONFIG.appName).toBe("Sunny");
    expect(SUNNY_CONFIG.locationWord).toBe("salon");
    expect(SUNNY_CONFIG.staffSystem).toBe("Woven");
    expect(SUNNY_CONFIG.formKeys).toEqual({ exit: "stc-exit", corrective: "dpoa", coaching: "coaching", followUpCoaching: "follow-up-coaching" });
    expect(SUNNY_CONFIG.locations().length).toBeGreaterThan(0);
  });
});

/** Tool and field names are the contract with the model, not wording: they are removed before looking for a word. */
const withoutIdentifiers = (text: string): string => text.replace(/[A-Za-z]*_[A-Za-z_]*/g, "").replace(/<[^>]*>/g, "").replace(/\bsalon (?:set to|:)/g, "").replace(/\b(?:salon|salons)\s*:/g, "");

describe("app config: another app's words", () => {
  it("changes every word in the rules book and the prompt", () => {
    setAppConfigForTests(FAKE);
    const rules = withoutIdentifiers(agentLoopRules());
    for (const word of ["salon", "Salon", "Woven", "stc-exit", "dpoa", "Sunny", "Sun Tan City"]) {
      expect(rules, `"${word}" is still in the prompt`).not.toContain(word);
    }
    expect(rules).toContain("kiosk");
    expect(rules).toContain("Rotaplan");
    expect(rules).toContain("qc-leaving");
    expect(rules).toContain("You are Zippo");
    expect(rules).toContain("Quartz Cafe");
    expect(rulesBookText(FAKE)).toBe(rulesBookText());
  });

  it("changes the tool descriptions and the per-turn facts", () => {
    setAppConfigForTests(FAKE);
    const described = JSON.stringify(agentLoopTools().map((tool) => ({ d: tool.description, s: tool.input_schema })));
    const words = withoutIdentifiers(described.replace(/"salon":/g, '"":'));
    expect(words).not.toMatch(/\bsalons?\b/i);
    expect(words).not.toContain("Sunny");
    expect(described).toContain("kiosk");
    const facts = agentLoopSystem({ managerName: "Test Testy", role: "manager", salons: ["Kiosk A"], today: "2026-11-02", templates: [], headings: [], openFormId: null });
    expect(facts).toContain("Their kiosks: Kiosk A.");
    expect(facts).toContain("(kiosk local date)");
    expect(facts).not.toMatch(/salon/i);
  });

  it("swapping back restores Sunny's words", () => {
    setAppConfigForTests(FAKE);
    expect(agentLoopRules()).not.toBe(fixture("sunny-system-rules.txt"));
    setAppConfigForTests();
    expect(agentLoopRules()).toBe(fixture("sunny-system-rules.txt"));
  });
});

describe("app config: no app literal is left in the loop's code", () => {
  const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const file of ["tools.ts", "run.ts", "rules-book.ts", "prompt.ts"]) {
    it(`${file} takes the staff system, the form keys and the location list from the config`, () => {
      const code = strip(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
      // Field names (inactive_in_woven, salon_from_woven) are the model contract; a word in a string is not.
      expect(code).not.toMatch(/(?<![\w])Woven(?![\w])/);
      expect(code).not.toMatch(/["'`](?:stc-exit|dpoa|follow-up-coaching)["'`]/);
      expect(code).not.toContain("PRODUCTION_SALONS");
      expect(code).not.toMatch(/\bSunny\b/);
    });
  }
});
