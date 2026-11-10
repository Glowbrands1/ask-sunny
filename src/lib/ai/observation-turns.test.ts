import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { holdFilledSlots } from "./keep-filled-slots";
import { observationTurns } from "./observation-turns";
import type { AskResponse } from "./types";

/**
 * QA's October triage of #257 (10 Nov 2026): the managers' turns exactly (names invented). After the request's
 * account, a later "not attendance, late opening" or a pasted Late Opening paragraph was appended to the Observation of
 * Offense. "Policy violated: Standards of Conduct" is already kept out on main with production's flags; pinned here too.
 * The replay case is `app/api/chat/replay-pack/nov10-incident-split-fix-cases.ts`.
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
/** The intent read's own lines, written in front of the turn as production's route does. */
const APP_LINES = "The form is the Corrective Action Form.\nThe employee is Avery Stone. Job title: Tanning Consultant. It happened on 10/21/2026. Incident: Late Opening.\n";

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

function reading(on: boolean) {
  process.env.INTENT_EXTRACTION_ENABLED = "1";
  process.env.MANAGER_WORDS_ONLY_ENABLED = "on";
  if (on) process.env.INCIDENT_SPLIT_FIX_ENABLED = "on";
  else delete process.env.INCIDENT_SPLIT_FIX_ENABLED;
}

describe("INCIDENT_SPLIT_FIX_ENABLED off: as on main", () => {
  it("passes every turn on as it is", () => {
    reading(false);
    const turns = [REQUEST, `${APP_LINES}not attendance, late opening`, PASTED];
    expect(observationTurns(turns, "Avery Stone")).toBe(turns);
  });

  it("adds the later correction and the pasted policy to the Observation (the reported bug)", () => {
    reading(false);
    expect(observation("not attendance, late opening")).toContain("not attendance");
    expect(observation(PASTED)).toContain("reimburse The Company");
  });
});

describe("INCIDENT_SPLIT_FIX_ENABLED on", () => {
  it.each([
    ["not attendance, late opening"],
    ["NOT ATTENDANCE, LATE OPENING"],
    ["Not attendance, late opening."],
    [PASTED],
    [PASTED.toLowerCase()],
    ["Policy violated: Standards of Conduct"],
    ["POLICY VIOLATED: STANDARDS OF CONDUCT"],
  ])("keeps the request's account after %s", (later) => {
    reading(true);
    const text = observation(later).toLowerCase();
    expect(text).toContain("avery opened the salon 20 minutes late");
    expect(text).not.toMatch(/policy violated|reimburse|not attendance/);
  });

  it.each([["not attendance, late opening"], [PASTED]])("leaves out %s when the intent read's lines are in front of it", (later) => {
    reading(true);
    expect(observationTurns([REQUEST, `${APP_LINES}${later}`], "Avery Stone")).toEqual([REQUEST]);
  });

  it("still adds a later account when the request told nothing", () => {
    reading(true);
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

  const LATER = "ok, make the grammatical changes mentioned that CAN be made. i will listen to at least 10 check-ins on the next shift we overlap.";
  it.each([LATER, LATER.toLowerCase(), LATER.toUpperCase()])("a later fact still adds to the account: %s", (later) => {
    reading(true);
    expect(observationTurns([REQUEST, later], "Avery Stone")).toContain(later);
  });

  it("keeps an edit turn for the edit rules", () => {
    reading(true);
    const edit = "change observation of offense to: not attendance, late opening";
    expect(observationTurns([REQUEST, edit], "Avery Stone")).toContain(edit);
  });
});
