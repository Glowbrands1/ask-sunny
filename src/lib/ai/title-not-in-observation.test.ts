import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import type { GroundedPerson } from "./grounded-entities";
import { holdFilledSlots } from "./keep-filled-slots";
import { onlyStatesJobTitle } from "./title-not-in-observation";
import type { AskResponse } from "./types";

/**
 * TITLE_NOT_IN_OBSERVATION_ENABLED. QA's October triage of #207 (10 Nov 2026), in #207's B16 wording ("create a
 * coaching form for Test Employee at Kearney, she is an HR assistant, for being late on 10-20-26"; the person here is
 * invented): with production's flags the card's Observation of Offense was "she is an HR assistant, being late on
 * 10-20-26". The title is who she is, not what happened.
 */
const FLAG = "TITLE_NOT_IN_OBSERVATION_ENABLED";
const NAME = "Remy Calder";
const TODAY = "2026-11-10";
const LEAD = `Here is what I would put on a **Coaching Form**.`;
const B16 = `create a coaching form for ${NAME} at Kearney, she is an HR assistant, for being late on 10-20-26`;

const PERSON: GroundedPerson = {
  id: "e-2",
  firstName: "Remy",
  lastName: "Calder",
  preferredFirstName: null,
  salonIds: ["loc-0309"],
  title: "Tanning Consultant",
  primaryLocationName: "Kearney",
};

const card: ChatFormProposal = {
  proposalId: "prop-207",
  templateKey: "coaching",
  templateName: "Coaching Form",
  supportsInlineDraft: true,
  variantKey: null,
  employeeName: NAME,
  employeeRole: null,
  formDate: null,
  locationId: "loc-0309",
  locationName: null,
  locationResolution: "resolved",
  authorizedLocationIds: ["loc-0309"],
  status: "ready",
  sourceMessageIds: [],
};

const observation = (question: string): string => {
  const answer: AskResponse = { content: LEAD, citations: [], recommendedVideoIds: [], formProposal: card };
  const held = holdFilledSlots({ response: answer, question, history: [], today: TODAY, people: [PERSON] });
  return /\*\*Observation of Offense:\*\*\s*(.*)/.exec(held.content)?.[1] ?? "";
};

beforeEach(() => {
  const production = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[] };
  for (const name of production.on) vi.stubEnv(name, "true");
  vi.stubEnv(FLAG, "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("#207 B16: \"she is an HR assistant\" stays out of the card's Observation", () => {
  it("off (production today): the title is in the Observation (the bug)", () => {
    vi.stubEnv(FLAG, "");
    expect(observation(B16)).toBe("she is an HR assistant, being late on 10-20-26");
  });

  it.each([
    B16,
    B16.toLowerCase(),
    `create a coaching form for ${NAME} at Kearney, she's an hr assistant, for being late on 10-20-26`,
    `create a coaching form for ${NAME} at Kearney, ${NAME} is an HR assistant, for being late on 10-20-26`,
  ])("on: %s → the Observation is the lateness alone", (said) => {
    const read = observation(said);
    expect(read).toMatch(/^being late on 10-20-26$/i);
  });

  it("on: an account clause that is not a title stays", () => {
    expect(observation(`create a coaching form for ${NAME} at Kearney, she is a no-show, for missing her shift on 10-20-26`)).toMatch(/no-show/);
  });
});

describe("onlyStatesJobTitle", () => {
  it("a clause that only says what the employee is", () => {
    expect(onlyStatesJobTitle("she is an HR assistant", NAME)).toBe(true);
    expect(onlyStatesJobTitle("she is an hr assistant", NAME)).toBe(true);
    expect(onlyStatesJobTitle("he's a shift lead", NAME)).toBe(true);
    expect(onlyStatesJobTitle("Remy is a tanning consultant", NAME)).toBe(true);
    expect(onlyStatesJobTitle("her position is assistant salon director", NAME)).toBe(true);
  });

  it("negative: what happened, a judgement, or another person stays", () => {
    expect(onlyStatesJobTitle("she is late", NAME)).toBe(false);
    expect(onlyStatesJobTitle("she is a no-show", NAME)).toBe(false);
    expect(onlyStatesJobTitle("she is a great consultant", NAME)).toBe(false);
    expect(onlyStatesJobTitle("she was rude to the assistant manager", NAME)).toBe(false);
    expect(onlyStatesJobTitle("she was rude to managers", NAME)).toBe(false);
    expect(onlyStatesJobTitle("she is rude to managers", NAME)).toBe(false);
    expect(onlyStatesJobTitle("Marnie is a tanning consultant", NAME)).toBe(false);
    expect(onlyStatesJobTitle("for being late on 10-20-26", NAME)).toBe(false);
  });
});
