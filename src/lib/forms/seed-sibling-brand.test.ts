import { describe, expect, it } from "vitest";

import * as catalog from "./catalog";
import { EMPLOYMENT_CHANGE_TEMPLATE_SEEDS } from "./employment-change-library";
import { EXIT_TEMPLATE_SEEDS } from "./exit-library";
import { HIRING_TEMPLATE_SEEDS } from "./hiring-library";
import { HR_TEMPLATE_SEEDS, TEMPLATE_SEEDS } from "./library";

/**
 * ============================================================================
 * NO BUFF CITY SOAP CONTENT IN ANY ASK SUNNY FORM SEED
 * ============================================================================
 *
 * Mirror of Ask Bubbles' `src/lib/forms/seed-sibling-brand.test.ts`. QA,
 * 25 Oct 2026, found the sibling company's name in a hidden Ask Bubbles seed
 * ("Sun Tan City Core Values" under the Buff City Soap letterhead). The two
 * apps share the forms engine and port seeds between them, so the leak can
 * run the other way too: Buff City Soap's name, its Woven company, or the
 * wording Ask Bubbles adopted for its own forms (the Makery, 7G Service, the
 * Forms Register) has no place on a Sun Tan City form.
 *
 * Every string of every seed in every form library — HR, exit, employment
 * change and hiring — is walked, and so is every string the catalog exports
 * (the letterhead brand among them). Each one is a real value, not a grep of
 * the source, so wording that arrives through a template literal or a shared
 * constant is caught too.
 *
 * Nothing was found on 25 Oct 2026; this test pins it.
 */
const SIBLING_CONTENT =
  /buff\s*city|buffcity|\bBCS\b|\bsoaps?\b|makery|ask\s*bubbles|\bbubbles\b|forms\s+register|\b7G\s+service|55839F24/i;

interface Allowed {
  /** The template key the string belongs to, or "catalog" for a catalog export. */
  where: string;
  /** The exact string. */
  text: string;
  /** The one phrase inside `text` that may stay. */
  phrase: string;
  reason: string;
}

/*
 * WHAT IS LEGITIMATELY SHARED, AND WHY. Empty: nothing on a Sun Tan City form
 * needs a Buff City Soap word. The things both companies do share — the JBA
 * Policy Manual, Careerplug, MyGlow, Sunlync — are not sibling wording and are
 * not matched above. An entry added here is one exact string and one phrase,
 * with its reason; any other sibling term in that string still fails.
 */
const ALLOWED: Allowed[] = [];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => strings(entry, out));
  return out;
}

function leftover(where: string, text: string): string {
  return ALLOWED.filter((entry) => entry.where === where && entry.text === text).reduce(
    (rest, entry) => rest.split(entry.phrase).join(""),
    text,
  );
}

const seedStrings = TEMPLATE_SEEDS.map((seed) => ({ where: seed.key, texts: strings(seed) }));
const catalogStrings = { where: "catalog", texts: strings(catalog) };

describe("every Ask Sunny form seed is free of Buff City Soap content", () => {
  it("the walk covers every form library", () => {
    expect(TEMPLATE_SEEDS.map((seed) => seed.key).sort()).toEqual(
      [...HR_TEMPLATE_SEEDS, ...EXIT_TEMPLATE_SEEDS, ...EMPLOYMENT_CHANGE_TEMPLATE_SEEDS, ...HIRING_TEMPLATE_SEEDS]
        .map((seed) => seed.key)
        .sort(),
    );
    expect(seedStrings.map((entry) => entry.where)).toEqual(TEMPLATE_SEEDS.map((seed) => seed.key));
    // The hiring forms Ask Bubbles hides are seeded here and walked like the rest.
    for (const key of ["tanning-consultant-interview", "management-interview-round-1", "management-interview-round-2"]) {
      expect(seedStrings.map((entry) => entry.where), key).toContain(key);
    }
  });

  it.each(seedStrings.map((entry) => [entry.where, entry] as const))("%s: no sibling-company wording", (_key, entry) => {
    const hits = entry.texts.filter((text) => SIBLING_CONTENT.test(leftover(entry.where, text)));
    expect(hits).toEqual([]);
  });

  it("the catalog (letterhead brand included) exports no sibling-company wording", () => {
    expect(catalog.BRAND).toBe("SUN TAN CITY");
    const hits = catalogStrings.texts.filter((text) => SIBLING_CONTENT.test(leftover("catalog", text)));
    expect(hits).toEqual([]);
  });

  it("the pattern catches the sibling company's wording (so an empty result means something)", () => {
    for (const text of [
      "BUFF CITY SOAP",
      "Tell me about yourself and why you’re interested in working at Buff City Soap.",
      "Never supplied by Ask Bubbles.",
      "This role involves hands-on work like cleaning the Makery and equipment and keeping the workspace organized.",
      "Follow through with 7G Service with every guest.",
      "Open the Forms Register.",
      "BCS store 12",
    ]) {
      expect(SIBLING_CONTENT.test(text), text).toBe(true);
    }
  });
});

describe("the allow-list stays narrow", () => {
  it("every entry matches a real string, and its phrase is in that string", () => {
    const all = [...seedStrings, catalogStrings];
    for (const entry of ALLOWED) {
      expect(entry.text, entry.reason).toContain(entry.phrase);
      expect(all.find((candidate) => candidate.where === entry.where)?.texts, `${entry.where}: ${entry.reason}`).toContain(entry.text);
    }
  });
});
