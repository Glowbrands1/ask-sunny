import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { caPolicyProposalLine, cleaningIncidentPhrase, readCaPolicy } from "./ca-policy";
import { describedManualSection } from "./named-policy-section";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * CLEANING LEFT UNDONE IS CARE AND CLEANING, CHOSEN BY THE CODE
 * (POLICY_CLEANING_INCIDENT_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026, in the managers' exact words (names invented):
 *
 *   T5  "cleaning duties not being completed", "weren't done", "didn't get
 *       done", "left dirty" -> a policy: Care and Cleaning of Equipment and
 *       Facilities p.21 when the account names cleaning or equipment,
 *       Standards of Conduct otherwise.
 *   9   the same chat gave Standards of Conduct p.12 on one run and Care and
 *       Cleaning p.21 on another: when the manager's words name the incident
 *       type, the code chooses, not the model.
 *
 * Fails with the flag off (no policy read; the model's heading stands) and
 * passes with it on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
const CARE = "Care and Cleaning of Equipment and Facilities";

const CLEANING = [
  "Create a verbal corrective action for Ione Varga, Salon Director, for cleaning duties not being completed.",
  "Ione Varga's cleaning duties weren't done on 10-18-26.",
  "The cleaning didn't get done during Ione Varga's shift on 10-18-26.",
  "Ione Varga left the beds dirty at close on 10-18-26.",
  "Ione Varga did not do the sanitize clean on the beds on 10-18-26.",
] as const;

const DUTIES = [
  "Ione Varga's closing duties weren't done on 10-18-26.",
  "Ione Varga's opening checklist didn't get done on 10-18-26.",
] as const;

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", "true");
// Flag-off pins hold whatever the environment has on; flag-on tests call on().
beforeEach(() => vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", ""));
const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);

describe("flag off: main reads no policy (the bug)", () => {
  it.each([...CLEANING.slice(0, 4), ...DUTIES])("%s", (text) => {
    expect(readCaPolicy(text).suggestion).toBeNull();
    expect(cited(text)).toEqual([]);
  });
});

describe("flag on: cleaning is Care and Cleaning p.21", () => {
  it.each(CLEANING)("%s", (text) => {
    on();
    expect(readCaPolicy(text).suggestion).toBeNull();
    expect(describedManualSection({ text, chunks: CHUNKS })?.section).toMatchObject({ heading: CARE, page: 21 });
    expect(cited(text)).toEqual([`${CARE} p.21`]);
  });

  it("the proposal says so, as a reading the manager can change", () => {
    on();
    const text = CLEANING[0];
    const found = describedManualSection({ text, chunks: CHUNKS })!;
    const line = caPolicyProposalLine(readCaPolicy(text), {
      phrase: found.phrase,
      lookup: "described",
      heading: found.section.heading,
      page: found.section.page,
      offenseKey: found.offenseKey,
    });
    expect(line).toContain(`**${CARE}** (page 21)`);
  });

  it("the card cites p.21 whatever heading the model chose (item 9: same chat, same policy)", () => {
    on();
    for (const modelHeading of ["Standards of Conduct", CARE, null]) {
      const citations = formTurnCitations({
        notes: CLEANING[1],
        chunks: CHUNKS,
        documentId: "manual",
        documentTitle: "JBA Policy Manual",
        modelHeading,
      });
      expect(citations.map((citation) => citation.locator)).toEqual(["Page 21"]);
    }
  });

  it("a policy the manager named still wins", () => {
    on();
    expect(cited("Ione Varga's cleaning duties weren't done. The policy violated is the standards of conduct.")).toEqual([
      "Standards of Conduct p.12",
    ]);
  });
});

describe("flag on: other duties left undone are the Standards of Conduct", () => {
  it.each(DUTIES)("%s", (text) => {
    on();
    const reading = readCaPolicy(text);
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(caPolicyProposalLine(reading)).toContain("**Standards of Conduct**");
    expect(describedManualSection({ text, chunks: CHUNKS })).toBeNull();
  });
});

describe("flag on: not an account of cleaning left undone", () => {
  it.each([
    "Ione Varga cleaned the beds before close.",
    "What is the cleaning policy?",
    "Ione Varga was late on 10-18-26 and the cleaning was done by someone else.",
  ])("%s", (text) => {
    on();
    expect(describedManualSection({ text, chunks: CHUNKS })?.section.heading).not.toBe(CARE);
  });
});

/* HOW MANAGERS TYPE (Pau, 26 Oct 2026): the same reading in all lowercase and in sentence case. */
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

describe("flag on: every register reads the same", () => {
  it.each([...CLEANING, ...DUTIES].flatMap((text) => [lower(text), sentence(text)]))("%s", (text) => {
    on();
    const original = [...CLEANING, ...DUTIES].find((entry) => entry.toLowerCase() === text.toLowerCase())!;
    expect(cited(text)).toEqual(cited(original));
    expect(readCaPolicy(text).suggestion).toBe(readCaPolicy(original).suggestion);
  });

  it.each(["cleaning duties werent done", "the cleaning didnt get done", "left the rooms dirty", "Didnt sanitize the beds"])(
    "terse: %s is Care and Cleaning p.21",
    (text) => {
      on();
      expect(cited(text)).toEqual([`${CARE} p.21`]);
    },
  );
});

/*
 * QA live, 26 Oct 2026 (G19, name invented): "written ca <name> 10/5 didnt do
 * 10 min sanitize at lawrence" missed Care and Cleaning p.21 (this flag was not
 * yet on). Code 9's live test typed "sanatizing": the misspellings and
 * "skipped" read the same.
 */
describe("flag on: G19 and the typed misspellings", () => {
  const G19 = "written ca wren okafor 10/5 didnt do 10 min sanitize at lawrence";
  it.each([
    G19,
    sentence(G19),
    G19.toUpperCase(),
    "she didnt do the sanatizing",
    "She didnt do the sanatizing",
    "didnt sanatize the beds",
    "she skipped the 10 minute sanitize on bed 4",
    "She skipped the 10 minute sanatize on bed 4",
    "never sanitzed the booths",
  ])("%s is Care and Cleaning p.21", (text) => {
    on();
    expect(cited(text)).toEqual([`${CARE} p.21`]);
  });

  it.each(["she sanatized every bed before close", "Santa's helper costume is not dress code"])("%s is not cleaning left undone", (text) => {
    on();
    expect(cited(text)).not.toContain(`${CARE} p.21`);
  });
});

/* QA-6, 26 Oct 2026 (names invented): negated and opposite wording is not cleaning left undone. */
describe("flag on: a negation undoes the incident", () => {
  const registers = (text: string) => [text, sentence(text), text.toUpperCase()];
  it.each(
    [
      "she never left the beds dirty",
      "the beds were not left dirty",
      "no dirty beds",
      "no one left the beds dirty",
      "she cleaned the beds, not left them dirty",
      "she did not fail to clean the beds",
      "it is not about cleaning, she was late",
      "not cleaning, attendance",
      "she is not responsible for cleaning",
      "cleaning duties were done",
      "cleaned the beds before close",
      "Rowan Pell did the cleaning, Avery Holt did not",
    ].flatMap(registers),
  )("%s reads no cleaning incident", (text) => {
    on();
    expect(cleaningIncidentPhrase(text)).toBeNull();
  });

  it.each(
    [
      "cleaning duties werent done",
      "left the beds dirty",
      "didnt sanitize the beds",
      "the beds were not cleaned",
      "she never cleaned the booths",
      "Rowan Pell cleaned, Avery Holt left the beds dirty",
    ].flatMap(registers),
  )("%s still reads the incident", (text) => {
    on();
    expect(cleaningIncidentPhrase(text)).not.toBeNull();
  });
});

/* QA-3, 26 Oct 2026, on describedManualSection with its prefix (name invented): denials and the later positive clause. */
describe("flag on: QA-3's denials and positives, through describedManualSection", () => {
  const PREFIX = "Create a verbal corrective action for Ione Varga. ";
  const registers = (text: string) => [text, sentence(text), text.toUpperCase()];
  const described = (text: string) => describedManualSection({ text: `${PREFIX}${text}`, chunks: CHUNKS })?.section.heading ?? null;

  it.each(
    [
      "she never left the beds dirty",
      "the beds were not left dirty",
      "no dirty beds",
      "she did not fail to clean the beds",
      "she is not responsible for cleaning",
      "she did not skip the sanitize",
      "it was not a cleaning problem",
      "it is not about cleaning, she was late",
      "cleaning was done on time",
      "the beds were clean",
    ].flatMap(registers),
  )("%s cites no Care and Cleaning", (text) => {
    on();
    expect(described(text)).not.toBe(CARE);
  });

  it.each(
    [
      "she was not late, but she left the beds dirty",
      "she left the beds dirty",
      "cleaning duties weren't done",
      "the cleaning didn't get done during her shift",
      "she did not do the sanitize clean on the beds",
      "she skipped the sanitize",
      "she didn't clean the beds",
      "it is not about cleaning, she left the beds dirty",
    ].flatMap(registers),
  )("%s cites Care and Cleaning", (text) => {
    on();
    expect(described(text)).toBe(CARE);
  });
});

/*
 * QA-3 and QA-7, 26 Oct 2026 (stand-in name invented): a refusal or failure
 * the manager denies is not an incident ("never refused to clean"), a habit
 * denial is not one ("she never skips the cleaning"), and leaving without
 * cleaning is one. Each in lowercase, sentence case and CAPS.
 */
describe("flag on: denied refusals and failures, and leaving without cleaning", () => {
  const PREFIX = "Create a verbal corrective action for Ione Varga. ";
  const registers = (text: string) => [text, sentence(text), text.toUpperCase()];
  const described = (text: string) => describedManualSection({ text: `${PREFIX}${text}`, chunks: CHUNKS })?.section.heading ?? null;

  const DENIED = [
    "never refused to clean",
    "she never refused to clean the lobby",
    "she did not refuse to clean",
    "she didn't refuse to clean",
    "she never skipped cleaning",
    "she never failed to clean",
    "she never skips the cleaning",
    "she never left without cleaning the restrooms",
  ].flatMap(registers);

  it.each(DENIED)("%s reads no cleaning incident", (text) => {
    on();
    expect(cleaningIncidentPhrase(text)).toBeNull();
    expect(described(text)).not.toBe(CARE);
  });

  it.each(["she left without cleaning the restrooms", "she went home without cleaning the lobby", "she failed to clean the lobby", "she skipped cleaning"].flatMap(registers))(
    "%s cites Care and Cleaning",
    (text) => {
      on();
      expect(cleaningIncidentPhrase(text)).not.toBeNull();
      expect(described(text)).toBe(CARE);
    },
  );

  it.each(DENIED)("flag off: %s reads nothing", (text) => {
    expect(cleaningIncidentPhrase(text)).toBeNull();
  });
});
