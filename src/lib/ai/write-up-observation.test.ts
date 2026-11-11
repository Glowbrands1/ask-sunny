import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import type { GroundedPerson } from "./grounded-entities";
import { holdFilledSlots } from "./keep-filled-slots";
import type { AskResponse } from "./types";
import { withoutWriteUpLead } from "./write-up-observation";

/**
 * WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED. QA's October triage of #167 (10 Nov 2026), in #167's wording ("write up Test
 * Employee for cell phone use"; the person here is invented): with production's flags the card's Observation of Offense
 * was the raw message. It should be the account, "cell phone use", without the request's words and the name.
 */
const FLAG = "WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED";
const NAME = "Marnie Holloway";
const TODAY = "2026-11-10";
const LEAD = `I'll draft a **Corrective Action Form** for **${NAME}** from what you've described, and check the applicable company policy before anything policy-related goes on it.`;

const PERSON: GroundedPerson = {
  id: "e-1",
  firstName: "Marnie",
  lastName: "Holloway",
  preferredFirstName: null,
  salonIds: ["loc-0309"],
  title: "Tanning Consultant",
  primaryLocationName: "Kearney",
};

const card: ChatFormProposal = {
  proposalId: "prop-167",
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
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

describe("#167: \"write up <employee> for cell phone use\" puts the account on the card, not the message", () => {
  it("off (production today): the Observation is the raw message (the bug)", () => {
    vi.stubEnv(FLAG, "");
    expect(observation(`write up ${NAME} for cell phone use`)).toBe(`write up ${NAME} for cell phone use`);
  });

  it.each([
    `write up ${NAME} for cell phone use`,
    `write up ${NAME.toLowerCase()} for cell phone use`,
    "Write up Marnie for cell phone use",
    `please write up ${NAME} for cell phone use`,
    `I need to write up ${NAME} for cell phone use`,
    `write ${NAME} up for cell phone use`,
  ])("on: %s → the Observation is \"Cell phone use\"", (said) => {
    const read = observation(said);
    expect(read).toBe("Cell phone use");
    expect(read).not.toMatch(/write|Marnie|Holloway/i);
  });
});

describe("withoutWriteUpLead", () => {
  it("cuts the request and the card's employee, keeps the account", () => {
    expect(withoutWriteUpLead(`write up ${NAME} for cell phone use`, NAME)).toBe("Cell phone use");
    expect(withoutWriteUpLead("can you please write up marnie for being on her phone at the front desk", NAME)).toBe("Being on her phone at the front desk");
  });

  it("negative: an account that only mentions a write-up, or another person, is as it was", () => {
    expect(withoutWriteUpLead("She was written up for cell phone use on 10/2", NAME)).toBe("She was written up for cell phone use on 10/2");
    expect(withoutWriteUpLead("write up Remy Calder for cell phone use", NAME)).toBe("write up Remy Calder for cell phone use");
    expect(withoutWriteUpLead("Marnie was on her phone during the shift", NAME)).toBe("Marnie was on her phone during the shift");
    expect(withoutWriteUpLead(`write up ${NAME} for cell phone use`, null)).toBe(`write up ${NAME} for cell phone use`);
  });

  it("nothing left: null", () => {
    expect(withoutWriteUpLead(`write up ${NAME} for it`, NAME)).toBeNull();
  });
});
