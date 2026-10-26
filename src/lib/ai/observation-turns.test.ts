import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { holdFilledSlots } from "./keep-filled-slots";
import { observationTurns } from "./observation-turns";
import type { AskResponse } from "./types";

/**
 * QA, 25 Oct 2026: the managers' turns exactly (names invented), on Sunny's
 * production reading (INTENT_EXTRACTION and MANAGER_WORDS_ONLY on). After
 * the request's account, a later "Policy violated: Standards of Conduct", a
 * one-line correction or a pasted policy paragraph became part of the
 * Observation of Offense.
 */
const FLAGS = ["INCIDENT_SPLIT_FIX_ENABLED", "INTENT_EXTRACTION_ENABLED", "MANAGER_WORDS_ONLY_ENABLED"] as const;
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const REQUEST = "create a ca for avery stone. on 10-21-26 avery opened the salon 20 minutes late.";
const PASTED =
  "When an employee assigned to open a location is unable to open the location at the proper time, the employee must notify the manager. The employee who failed to open will then be required to reimburse The Company $25";

const CARD: ChatFormProposal = {
  proposalId: "p",
  supportsInlineDraft: true,
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
  variantKey: null,
  employeeName: "Avery Stone",
  employeeRole: null,
  locationId: null,
  locationName: null,
  locationResolution: "not_applicable",
  authorizedLocationIds: [],
  status: "ready",
  sourceMessageIds: [],
};

function observation(later: string): string {
  const response = { content: "I'll draft a **Corrective Action Form** for **Avery Stone**.", citations: [], formProposal: CARD } as unknown as AskResponse;
  const out = holdFilledSlots({
    response,
    question: later,
    history: [
      { role: "user", content: REQUEST },
      { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Avery Stone**.", formProposal: CARD },
    ],
    today: "2026-10-25",
    people: [],
  });
  return /\*\*Observation of Offense:\*\* (.*)/.exec(out.content)?.[1] ?? "";
}

function on() {
  process.env.INTENT_EXTRACTION_ENABLED = "1";
  process.env.MANAGER_WORDS_ONLY_ENABLED = "on";
}

describe("INCIDENT_SPLIT_FIX_ENABLED off: as on main", () => {
  it("adds the later policy line to the Observation", () => {
    on();
    delete process.env.INCIDENT_SPLIT_FIX_ENABLED;
    expect(observation("Policy violated: Standards of Conduct")).toContain("Policy violated");
    expect(observation(PASTED)).toContain("reimburse The Company");
  });
});

describe("INCIDENT_SPLIT_FIX_ENABLED on", () => {
  it.each([["Policy violated: Standards of Conduct"], ["not attendance, late opening"], [PASTED], [PASTED.toLowerCase()], ["POLICY VIOLATED: STANDARDS OF CONDUCT"]])(
    "keeps the request's account after %s",
    (later) => {
      on();
      process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
      const text = observation(later);
      expect(text.toLowerCase()).toContain("avery opened the salon 20 minutes late");
      expect(text.toLowerCase()).not.toMatch(/policy violated|reimburse|not attendance/);
    },
  );

  it("still adds a later account when the request told nothing", () => {
    on();
    process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
    const response = { content: "x", citations: [], formProposal: CARD } as unknown as AskResponse;
    const out = holdFilledSlots({
      response,
      question: "on 10-21-26 she opened the salon 20 minutes late",
      history: [{ role: "user", content: "create a ca for avery stone" }, { role: "assistant", content: "x", formProposal: CARD }],
      today: "2026-10-25",
      people: [],
    });
    expect(out.content).toMatch(/\*\*Observation of Offense:\*\* .*opened the salon 20 minutes late/);
  });

  it("does not cut '<place>, <state>' at the comma", () => {
    on();
    process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
    const response = { content: "x", citations: [], formProposal: { ...CARD, employeeName: "Devon Hale" } } as unknown as AskResponse;
    const out = holdFilledSlots({
      response,
      question: "Please create a corrective action form for Devon Hale, she works at our kearney, ne salon as a tc and was late today.",
      history: [],
      today: "2026-10-25",
      people: [],
    });
    expect(out.content).not.toMatch(/\*\*Observation of Offense:\*\* ne salon/);
    expect(out.content).toMatch(/\*\*Observation of Offense:\*\* .*was late today/);
  });
});

/**
 * QA-2, 26 Oct 2026, with INCIDENT_SPLIT_FIX_ENABLED on alone: S12
 * (edits-dates-replay-e2e) lost the later fact "i will listen to at least 10
 * check-ins on the next shift we overlap.", and remap-incident-oct24 kept
 * "tanning consultant at empire sd." in the account.
 */
describe("INCIDENT_SPLIT_FIX_ENABLED on: later facts and '<place>, <state>.'", () => {
  const LATER = "ok, make the grammatical changes mentioned that CAN be made. i will listen to at least 10 check-ins on the next shift we overlap.";

  it.each([LATER, LATER.toLowerCase(), LATER.toUpperCase()])("a later fact still adds to the account: %s", (later) => {
    on();
    process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
    expect(observationTurns(["create a ca for avery stone. on 10-21-26 avery opened the salon 20 minutes late.", later], "Avery Stone")).toContain(later);
  });

  it.each([
    "tanning consultant at empire, sd. on 10-22-26 Test was not scheduled to work",
    "Tanning Consultant at Empire, SD. On 10-22-26 Test was not scheduled to work",
    "TANNING CONSULTANT AT EMPIRE, SD. ON 10-22-26 TEST WAS NOT SCHEDULED TO WORK",
  ])("keeps the comma when the state ends the sentence: %s", (turn) => {
    process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
    expect(observationTurns([turn], "Test")[0]).toBe(turn);
  });
});
