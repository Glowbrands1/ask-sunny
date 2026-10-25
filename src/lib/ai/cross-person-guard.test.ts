import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { guardCrossPersonIncident, samePerson, withCrossPersonGuard } from "./cross-person-guard";
import type { AskRequest, AskResponse } from "./types";

/**
 * Ask Sunny conv_mvoetxo92fraflz, 25 Oct 2026. The manager's turns and the
 * app's replies are copied exactly; every person's name is invented (Marla
 * Quince is the first employee, Tobin Ashgrove the new hire in her incident,
 * Petra Linwood the second employee).
 *
 * Turn 3 "create a coaching document for Petra Linwood" put Petra on the card
 * and kept Marla's incident in Observation of Offense and on the draft.
 */
const FLAG = "CROSS_PERSON_INCIDENT_GUARD_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const TURN_1 =
  "create a coaching document for Marla Quince regarding On 10-16-26 the Woven policy acknowledgement report reflected that Tobin Ashgrove did not complete required policy acknowledgements during her onboarding on 9-28-26. Marla is responsible for making sure all new hires complete required policy acknowledgements during onboarding.";
const TURN_2 = "coaching form for Marla Quince";
const TURN_3 = "create a coaching document for Petra Linwood";

const MARLA_OBSERVATION =
  "Marla Quince regarding On 10-16-26 the Woven policy acknowledgement report reflected that Tobin Ashgrove did not complete required policy acknowledgements during her onboarding on 9-28-26. Marla is responsible for making sure all new hires complete required policy acknowledgements during onboarding.";

function reply(jobTitle: string): string {
  return [
    "Here is what I would put on a **Coaching Form**.",
    "",
    "Everything I need is here, drawn from your messages above.",
    "",
    "I have the employee and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.",
    "",
    "Orientation Policy, JBA Policy Manual p.33",
    "",
    "**Date:** 10/16/2026",
    "",
    `**Job title:** ${jobTitle}`,
    "",
    `**Observation of Offense:** ${MARLA_OBSERVATION}`,
  ].join("\n");
}

function card(employeeName: string, sourceMessageIds: string[]): ChatFormProposal {
  return {
    proposalId: `prop-${employeeName}`,
    supportsInlineDraft: true,
    templateKey: "coaching",
    templateName: "Coaching Form",
    variantKey: null,
    employeeName,
    employeeRole: null,
    formDate: "2026-10-16",
    locationId: "salon-1",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds,
  };
}

const HISTORY = [
  { id: "m0", role: "user", content: TURN_1 },
  { id: "m1", role: "assistant", content: reply("Assistant"), formProposal: card("Marla Quince", ["m0"]) },
  { id: "m2", role: "user", content: TURN_2 },
  { id: "m3", role: "assistant", content: reply("Assistant"), formProposal: card("Marla Quince", ["m0", "m2"]) },
];

const TURN_3_RESPONSE: AskResponse = {
  content: reply("Salon Director"),
  citations: [],
  formProposal: card("Petra Linwood", ["m0", "m2", "m4"]),
} as unknown as AskResponse;

const REQUEST = {
  question: TURN_3,
  questionMessageId: "m4",
  history: HISTORY,
  context: { todayIso: "2026-10-25" },
} as unknown as AskRequest;

describe("CROSS_PERSON_INCIDENT_GUARD_ENABLED off", () => {
  it("returns the turn-3 card as main does, Marla's incident included", () => {
    delete process.env[FLAG];
    const out = withCrossPersonGuard(TURN_3_RESPONSE, REQUEST);
    expect(out).toBe(TURN_3_RESPONSE);
    expect(out.content).toContain("Tobin Ashgrove did not complete");
  });
});

describe("CROSS_PERSON_INCIDENT_GUARD_ENABLED on", () => {
  it("does not carry Marla's incident onto Petra's card or draft", () => {
    process.env[FLAG] = "on";
    const out = withCrossPersonGuard(TURN_3_RESPONSE, REQUEST);
    expect(out.formProposal?.employeeName).toBe("Petra Linwood");
    expect(out.content).not.toContain("Marla");
    expect(out.content).not.toContain("Tobin Ashgrove");
    expect(out.content).not.toContain("**Date:** 10/16/2026");
    expect(out.formProposal?.formDate).toBeNull();
    // The draft is written from these turns only: Petra's request, not Marla's account.
    expect(out.formProposal?.sourceMessageIds).toEqual(["m4"]);
    // What does not belong to the incident stays.
    expect(out.content).toContain("**Job title:** Salon Director");
    expect(out.content).toContain("Here is what I would put on a **Coaching Form**.");
  });

  it("reads Petra's own account when the switching turn gives one", () => {
    process.env[FLAG] = "on";
    const question = "create a coaching document for Petra Linwood, on 10-20-26 she left the salon unlocked at close";
    const out = guardCrossPersonIncident({
      response: TURN_3_RESPONSE,
      question,
      questionMessageId: "m4",
      history: HISTORY,
      today: "2026-10-25",
    });
    expect(out.content).toMatch(/\*\*Observation of Offense:\*\* .*left the salon unlocked at close/);
    expect(out.content).not.toContain("Tobin Ashgrove");
    expect(out.formProposal?.formDate).toBe("2026-10-20");
    expect(out.content).toContain("**Date:** 10/20/2026");
  });

  it("asks payroll and the warning level again instead of carrying the first request's answers", () => {
    process.env[FLAG] = "on";
    // Ask Bubbles conv_mvoftzhs29se8nb, same carry-over: "no payroll deduct" was said for the first employee.
    const history = [
      { id: "b0", role: "user", content: "create verbal CA for Marla Quince for violating visitors at work policy on 10-10-26. no payroll deduct" },
      { id: "b1", role: "assistant", content: "…", formProposal: { ...card("Marla Quince", ["b0"]), templateKey: "dpoa", templateName: "Corrective Action Form" } },
    ];
    const response = {
      content: [
        "I'll draft a **Corrective Action Form** for **Petra Linwood** from what you've described.",
        "",
        "**Type of Warning:** Verbal Warning, as you said — I'll tick it on the form. Tell me if that should change.",
        "",
        "Is payroll deduct applicable? **No** — tell me if that should change.",
      ].join("\n"),
      citations: [],
      formProposal: { ...card("Petra Linwood", ["b0", "b2"]), templateKey: "dpoa", templateName: "Corrective Action Form", warningLevel: "verbal", payrollDeduct: "no" },
    } as unknown as AskResponse;
    const out = guardCrossPersonIncident({
      response,
      question: "create a corrective action form for Petra Linwood. on 10-20-26 petra was on her cell phone for over 30 minutes",
      questionMessageId: "b2",
      history,
      today: "2026-10-25",
    });
    expect(out.formProposal?.payrollDeduct).toBeNull();
    expect(out.formProposal?.warningLevel).toBeNull();
    expect(out.content).not.toContain("**No** — tell me");
    expect(out.content).not.toContain("Verbal Warning, as you said");
    expect(out.content).toContain("**Is payroll deduct applicable?** Yes or No?");
    expect(out.content).toContain("**Verbal Warning** or a **Written Warning**?");
  });

  it("changes nothing when the card keeps the same person", () => {
    process.env[FLAG] = "on";
    const same = { ...TURN_3_RESPONSE, content: reply("Assistant"), formProposal: card("Marla Quince", ["m0", "m2", "m4"]) };
    const out = withCrossPersonGuard(same, { ...REQUEST, question: TURN_2 } as AskRequest);
    expect(out).toBe(same);
  });

  it("treats a respelling of one name as the same person", () => {
    expect(samePerson("mara quill", "Mara Quil")).toBe(true);
    expect(samePerson("Marla Quince", "Marla Quinse")).toBe(true);
    expect(samePerson("Marla Quince", "Petra Linwood")).toBe(false);
  });

  it("reads the switch in lowercase and sentence case, and QA's terse twin", () => {
    process.env[FLAG] = "on";
    for (const question of [TURN_3.toLowerCase(), "Create a coaching document for petra linwood", "coach petra linwood"]) {
      const out = withCrossPersonGuard({ ...TURN_3_RESPONSE, formProposal: card("petra linwood", ["m0", "m2", "m4"]) } as AskResponse, { ...REQUEST, question } as AskRequest);
      expect(out.content).not.toContain("Tobin Ashgrove");
      expect(out.formProposal?.sourceMessageIds).toEqual(["m4"]);
    }
  });

  it("QA batch 12 terse twin: 'coach marla quince woven acks 10-16' then 'coach petra linwood'", () => {
    process.env[FLAG] = "on";
    const history = [
      { id: "t0", role: "user", content: "coach marla quince woven acks 10-16" },
      { id: "t1", role: "assistant", content: "x", formProposal: card("marla quince", ["t0"]) },
    ];
    const response = {
      content: "Here is what I would put on a **Coaching Form**.\n\n**Observation of Offense:** coach marla quince woven acks 10-16",
      citations: [],
      formProposal: card("petra linwood", ["t0", "t2"]),
    } as unknown as AskResponse;
    const out = guardCrossPersonIncident({ response, question: "coach petra linwood", questionMessageId: "t2", history, today: "2026-10-25" });
    expect(out.content.toLowerCase()).not.toContain("marla");
    expect(out.formProposal?.sourceMessageIds).toEqual(["t2"]);
  });
});
