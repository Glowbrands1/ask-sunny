import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { rosterOnlyNames } from "./roster-only-names";
import { namesOnlyASalon } from "./salon-mention";

/**
 * STORE_WORD_NOT_A_MISSING_PERSON_ENABLED (port of the sibling app's flip-3 gate, QA, 6 Nov 2026): "coaching form for
 * Kearney, the team was slow at the front desk on 11/2" — "Kearney" is the salon, never "I couldn't find **Kearney**
 * in the Woven roster". The end-to-end case is `nov6-store-word-cases.ts`. The people are invented.
 */
const ROSTER = ["Marnie Holloway", "Remy Calder"];
const MESSAGE = "coaching form for Kearney, the team was slow at the front desk on 11/2";
const NOT_FOUND = /I couldn't find \*\*Kearney\*\* in the Woven roster/;

function card(employeeName: string | null): ChatFormProposal {
  return {
    proposalId: "p1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName,
    employeeRole: null,
    formDate: null,
    locationId: "loc-0309",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: ["loc-0309"],
    status: employeeName ? "ready" : "needs_employee",
    sourceMessageIds: [],
  } as ChatFormProposal;
}

const reply = (employee: string | null): AskResponse => ({
  content: "Here is what I would put on a **Coaching Form**.\n\nWho is this form for? Tell me the employee's full name.",
  citations: [],
  recommendedVideoIds: [],
  formProposal: card(employee),
});

function nameFlags(): void {
  vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "true");
  vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
}

afterEach(() => vi.unstubAllEnvs());

describe("the salon word", () => {
  it("is read as a salon, however it is typed; a person's name is not", () => {
    expect(namesOnlyASalon("Kearney")).toBe(true);
    expect(namesOnlyASalon("kearney")).toBe(true);
    expect(namesOnlyASalon("Grand Island")).toBe(true);
    expect(namesOnlyASalon("Remy Calder")).toBe(false);
    expect(namesOnlyASalon("Kearney Pellerin")).toBe(false);
  });
});

describe("the not-found note, with the name flags on", () => {
  it("STORE_WORD_NOT_A_MISSING_PERSON_ENABLED off: as before (the bug), the salon is said back as a person not found", () => {
    nameFlags();
    expect(rosterOnlyNames(reply("Kearney"), ROSTER, MESSAGE).content).toMatch(NOT_FOUND);
  });

  it("on: the salon is never said back as a person not found, and the card still asks who", () => {
    nameFlags();
    vi.stubEnv("STORE_WORD_NOT_A_MISSING_PERSON_ENABLED", "true");
    const out = rosterOnlyNames(reply("Kearney"), ROSTER, MESSAGE);
    expect(out.content).not.toMatch(NOT_FOUND);
    expect(out.formProposal?.employeeName ?? null).toBeNull();
    expect(out.content).toMatch(/Who is this form for\?/);
  });

  it("on: a person not on the roster is still said back as not found", () => {
    nameFlags();
    vi.stubEnv("STORE_WORD_NOT_A_MISSING_PERSON_ENABLED", "true");
    const out = rosterOnlyNames(reply("Zebulon Marchbanks"), ROSTER, "create a ca form for Zebulon Marchbanks, he was late on 11/2");
    expect(out.content).toMatch(/I couldn't find \*\*Zebulon Marchbanks\*\* in the Woven roster/);
  });
});
