import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";
import { placeSpanGuardEnabled } from "@/lib/config/chat-quality-flags";
import { holdFilledSlots } from "@/lib/ai/keep-filled-slots";
import { decideIntentTurn } from "@/lib/ai/intent-slots";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { readEmploymentChange } from "./employment-change";
import { readPlaceState } from "./place-state";

/**
 * ============================================================================
 * "CITE ANIMALS IN THE WORKPLACE POLICY" IS NOT A PLACE
 * ============================================================================
 *
 * Ask Bubbles conv_mvmcetjw2i4vtwz, 24 Oct 2026. The manager asked for a
 * policy, then named the place:
 *
 *   "cite animals in the workplace policy"
 *   "store location is empire, sd. create corrective action"
 *
 * and the card asked about a typed store called "workplace policy". The same
 * two turns, with the salon word and a real roster salon in place of the
 * store, through each place reader on Ask Sunny's live path: the
 * "<place>, <state>" reader (`readPlaceState`, which joins the turns), the
 * intent-slot salon (`decideIntentTurn`, INTENT_EXTRACTION_ENABLED is on in
 * production), the form card (`holdFilledSlots`), and the employment-change
 * labelled location, which keeps an unmatched value as typed.
 */

const POLICY_TURN = "cite animals in the workplace policy";
const CREATE = "create corrective action";

const KEARNEY = PRODUCTION_SALONS.find((salon) => salon.name === "NE Kearney")!;
const PINE_LAKE = PRODUCTION_SALONS.find((salon) => salon.name === "NE Lincoln Pine Lake")!;
const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));

/** The place, or "unknown"/"none", as `readPlaceState` reads the turns in order. */
function placeRead(turns: readonly string[]): string {
  const read = readPlaceState(turns.join("\n"));
  return read.kind === "one" ? read.salon.name : read.kind;
}

/**
 * The intent-slot salon, the last turn being this one. The intent reader puts
 * this turn first and the history after it, so a policy asked for after the
 * place ran into the place.
 */
function intentSalon(turns: readonly string[]): string | null {
  const question = turns[turns.length - 1]!;
  const history = turns.slice(0, -1).map((content) => ({ role: "user", content }));
  const decision = decideIntentTurn({
    question,
    history,
    today: "2026-10-24",
    saved: null,
    raw: null,
    people: [],
    salons: SALONS,
    headings: [],
    templates: [{ key: "dpoa", name: "Corrective Action Form" }],
    formInProgress: true,
  });
  return decision.state.salonId;
}

/** The card after the slots the conversation filled are put back. */
function card(turns: readonly string[], proposed: Partial<ChatFormProposal>): ChatFormProposal {
  const formProposal: ChatFormProposal = {
    proposalId: "prop-place-span",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: "Test Employee",
    employeeRole: null,
    formDate: null,
    locationId: null,
    locationName: null,
    locationResolution: "needs_selection",
    authorizedLocationIds: [KEARNEY.id, PINE_LAKE.id],
    status: "ready",
    sourceMessageIds: [],
    ...proposed,
  };
  const response: AskResponse = { content: "Here is the Corrective Action Form.", citations: [], recommendedVideoIds: [], formProposal };
  const question = turns[turns.length - 1]!;
  const history = turns.slice(0, -1).map((content) => ({ role: "user", content }));
  return holdFilledSlots({ response, question, history, today: "2026-10-24", people: [] }).formProposal!;
}

const NOT_A_DOCUMENT = /workplace|polic(?:y|ies)|manual|handbook|section/i;

beforeEach(() => {
  vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "");
  vi.stubEnv("INTENT_EXTRACTION_ENABLED", "1");
  vi.stubEnv("CODE_SLOTS_ENABLED", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PLACE_SPAN_GUARD_ENABLED", () => {
  it("defaults off", () => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", undefined);
    expect(placeSpanGuardEnabled()).toBe(false);
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
    expect(placeSpanGuardEnabled()).toBe(true);
  });

  it("off: the reported behaviour is unchanged (the policy words are read into the place)", () => {
    expect(placeRead([POLICY_TURN, `at Kearney, NE. ${CREATE}`])).toBe("unknown");
    expect(intentSalon(["at Pine Lake, NE", "cite animals in workplace policy"])).toBeNull();
    // The conversation's own earlier turn: "cite pets in workplace".
    expect(intentSalon(["at Pine Lake, NE", "cite pets in workplace"])).toBeNull();
    expect(card([POLICY_TURN, `Kearney, NE. ${CREATE}`], { locationId: KEARNEY.id, locationName: KEARNEY.name, locationResolution: "resolved" }).locationId).toBeNull();
    expect(readEmploymentChange([POLICY_TURN, "transfer Avery Testperson to Kearney, per the new salon policy"], "2026-10-24").next.location).toBe("Policy");
  });
});

describe("the conversation's own turns: '<location> is <place>' (passes with the guard off and on)", () => {
  for (const flag of ["", "1"]) {
    it(`flag ${flag ? "on" : "off"}: "salon location is Kearney, NE" after the policy turn is Kearney`, () => {
      vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", flag);
      const turns = [POLICY_TURN, `salon location is Kearney, NE. ${CREATE}`];
      expect(placeRead(turns)).toBe(KEARNEY.name);
      expect(intentSalon(turns)).toBe(KEARNEY.id);
      const held = card(turns, {});
      expect(held.locationId).toBe(KEARNEY.id);
      expect(`${held.locationName ?? ""} ${held.namedLocationOutOfScope ?? ""}`).not.toMatch(NOT_A_DOCUMENT);
    });

    it(`flag ${flag ? "on" : "off"}: an unknown place is asked about, never the policy`, () => {
      vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", flag);
      const turns = [POLICY_TURN, `salon location is empire, ne. ${CREATE}`];
      expect(placeRead(turns)).toBe("unknown");
      expect(intentSalon(turns)).toBeNull();
      const held = card(turns, {});
      expect(held.locationId).toBeNull();
      expect(`${held.locationName ?? ""} ${held.namedLocationOutOfScope ?? ""}`).not.toMatch(NOT_A_DOCUMENT);
    });
  }
});

describe("conv_mvmcetjw2i4vtwz: a policy phrase is not a place (flag on)", () => {
  beforeEach(() => {
    vi.stubEnv("PLACE_SPAN_GUARD_ENABLED", "1");
  });

  it("reads the salon from 'at Kearney, NE' after the policy turn", () => {
    expect(placeRead([POLICY_TURN, `at Kearney, NE. ${CREATE}`])).toBe(KEARNEY.name);
  });

  it("reads it when the policy and the place are one message", () => {
    expect(placeRead([`${POLICY_TURN} at Kearney, NE. ${CREATE}`])).toBe(KEARNEY.name);
  });

  it("intent slots: 'at Pine Lake, NE' then the policy turn is still Lincoln Pine Lake", () => {
    expect(intentSalon(["at Pine Lake, NE", "cite animals in workplace policy"])).toBe(PINE_LAKE.id);
    // No document word here: each turn read on its own is what keeps the salon.
    expect(intentSalon(["at Pine Lake, NE", "cite pets in workplace"])).toBe(PINE_LAKE.id);
    expect(intentSalon(["cite animals in workplace policy", `at Pine Lake, NE. ${CREATE}`])).toBe(PINE_LAKE.id);
  });

  it("form card: the salon already on the card stays after the policy turn", () => {
    const held = card([POLICY_TURN, `Kearney, NE. ${CREATE}`], {
      locationId: KEARNEY.id,
      locationName: KEARNEY.name,
      locationResolution: "resolved",
    });
    expect(held.locationId).toBe(KEARNEY.id);
    expect(held.locationName ?? "").not.toMatch(NOT_A_DOCUMENT);
  });

  it("employment change: a labelled location that names a document is not the salon", () => {
    const today = "2026-10-24";
    const transfer = readEmploymentChange([POLICY_TURN, "transfer Avery Testperson to Kearney, per the new salon policy"], today);
    expect(transfer.next.location).toBe(KEARNEY.name);
    const labelled = readEmploymentChange(["current location is the workplace policy. new salon is Kearney"], today);
    expect(labelled.current.location).toBeUndefined();
    expect(labelled.next.location).toBe(KEARNEY.name);
    expect(readEmploymentChange(["demote Avery Testperson from SD to TC. new store policy applies"], today).next.location).toBeUndefined();
  });

  it("still keeps a labelled location as typed when it names no document", () => {
    const facts = readEmploymentChange(["transfer Avery Testperson. new location is salon 12"], "2026-10-24");
    expect(facts.next.location).toBe("Salon 12");
  });

  it("still reads a place in a roster state that no salon answers to as unknown", () => {
    expect(placeRead([POLICY_TURN, "at Springfield, NE"])).toBe("unknown");
  });
});
