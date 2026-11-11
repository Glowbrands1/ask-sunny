import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";
import { EMPTY_FORM_STATE } from "@/lib/ai/form-state";
import { decideIntentTurn } from "@/lib/ai/intent-slots";
import { holdFilledSlots } from "@/lib/ai/keep-filled-slots";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { labelledSalonIds } from "./salon-cue";

/**
 * ============================================================================
 * "LOCATION ST JOE" AFTER "SALON IS WORNALL" IS ST JOSEPH
 * ============================================================================
 *
 * QA Round 4, conv_mvmw4hwq292a6vq (and conv_mvmtli622utibvm), 24 Oct 2026.
 * The manager's turns, word for word (the employee names are QA's own test
 * names). The salon was set to Wornall by turn 6, and turn 8 named St Joe;
 * every later card stayed on Wornall (loc-0306).
 */
const TURNS = [
  "create a ca form for test testy because she didnt do deep clean assigned by 9-15-26",
  "deep clean assigned 9-1-26 of room 1 and due by 9-15-26. no previous coaching or ca on file",
  "employee acknowledged the jba policy manual so do a ca form.",
  "Create a form from this conversation.",
  "name is test testy",
  "employee name is test testy and salon is wornall",
  "Create a Corrective Action Form from this conversation.",
  "name is test testyone, location st joe, today's date, employee did not properly sanitize room 12 after guest. this is written. employee had verbal ca 9-1-26. employee is a tc-tanning consultant",
];

const salonId = (name: string) => PRODUCTION_SALONS.find((salon) => salon.name === name)!.id;
const WORNALL = salonId("MO Kansas City Wornall");
const ST_JOSEPH = salonId("MO St Joseph");
const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));

/** The intent-slot salon on the last turn, with Wornall already saved from turn 6. */
function intentSalon(turns: readonly string[]): string | null {
  return decideIntentTurn({
    question: turns[turns.length - 1]!,
    history: turns.slice(0, -1).map((content) => ({ role: "user", content })),
    today: "2026-10-24",
    saved: { ...EMPTY_FORM_STATE, employeeName: "Test Testy", salonId: WORNALL, templateKey: "dpoa" },
    raw: null,
    people: [],
    salons: SALONS,
    headings: [],
    templates: [{ key: "dpoa", name: "Corrective Action Form" }],
    formInProgress: true,
  }).state.salonId;
}

/** The card's salon on the last turn, the proposal still carrying Wornall as it did live. */
function cardSalon(turns: readonly string[]): string | null {
  const formProposal: ChatFormProposal = {
    proposalId: "prop-st-joe",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: "Test Testyone",
    employeeRole: null,
    formDate: null,
    locationId: WORNALL,
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: PRODUCTION_SALONS.map((salon) => salon.id),
    status: "ready",
    sourceMessageIds: [],
  };
  const response: AskResponse = { content: "Here is the Corrective Action Form.", citations: [], recommendedVideoIds: [], formProposal };
  return holdFilledSlots({
    response,
    question: turns[turns.length - 1]!,
    history: turns.slice(0, -1).map((content) => ({ role: "user", content })),
    today: "2026-10-24",
    people: [],
  }).formProposal!.locationId;
}

beforeEach(() => {
  vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "");
  vi.stubEnv("INTENT_EXTRACTION_ENABLED", "1");
  vi.stubEnv("CODE_SLOTS_ENABLED", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("QA Round 4: 'location st joe' (PLACE_SPAN_GUARD_ENABLED)", () => {
  it("off: the reported behaviour is unchanged (the card stays on Wornall)", () => {
    expect(intentSalon(TURNS)).toBe(WORNALL);
    expect(cardSalon(TURNS)).toBe(WORNALL);
  });

  it("on: the newest turn's salon replaces the saved one on the intent slots and the card", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    expect(intentSalon(TURNS)).toBe(ST_JOSEPH);
    expect(cardSalon(TURNS)).toBe(ST_JOSEPH);
  });

  it("on: turn 6 'salon is wornall' is read as Wornall", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    expect(labelledSalonIds(TURNS[5]!)).toEqual([WORNALL]);
  });

  it("on: a field label before the salon is a place cue", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    for (const turn of ["location st joe", "salon st joe", "location is st joe", "st joe location", "store: st joe"]) {
      expect(labelledSalonIds(turn), turn).toEqual([ST_JOSEPH]);
    }
    expect(labelledSalonIds("location lawrence, she was late")).toEqual([salonId("KS Lawrence")]);
  });

  it("on: the document-phrase guard and the label cue together", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    const turns = [...TURNS.slice(0, 7), "cite animals in the workplace policy, location st joe"];
    expect(intentSalon(turns)).toBe(ST_JOSEPH);
    expect(cardSalon(turns)).toBe(ST_JOSEPH);
  });

  it("on: the roster reader's own rules still hold behind a label", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    // "at liberty to" is an idiom; a label does not change that.
    expect(labelledSalonIds("the salon liberty to decide")).toEqual([]);
    // A number with a location word keeps its number reading.
    expect(labelledSalonIds("salon 0410")).toEqual([salonId("NE Omaha Pacific")]);
    // A turn that names no salon leaves the saved one.
    expect(intentSalon([...TURNS.slice(0, 6), "this is written"])).toBe(WORNALL);
  });
});
