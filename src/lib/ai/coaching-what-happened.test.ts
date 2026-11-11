import { describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { askCoachingWhatHappened, COACHING_WHAT_HAPPENED_NOTE } from "./ca-what-happened";
import type { AskResponse } from "./types";

/**
 * COACHING_ASKS_WHAT_HAPPENED_ENABLED (Pau, 5 Nov 2026, sf-s27): "Create a
 * coaching form." → "<name>" answered "Everything I need is here … I have the
 * employee and the salon." with no incident. The reply lines are production's;
 * the person is invented.
 */

function coaching(employeeName: string, subject?: "team"): ChatFormProposal {
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
    status: "ready",
    sourceMessageIds: [],
    ...(subject ? { subject } : {}),
  };
}

const LIVE =
  "Here is what I would put on a **Coaching Form**.\n\nEverything I need is here, drawn from your messages above.\n\nI have the employee and the salon. Create the draft here and you can fill in the rest on the form.";

const reply = (content: string, proposal: ChatFormProposal): AskResponse => ({ content, citations: [], recommendedVideoIds: [], formProposal: proposal });
const HISTORY = [
  { role: "user", content: "Create a coaching form." },
  { role: "assistant", content: "Who is this **Coaching Form** for?" },
];

describe("a Coaching Form card with no account", () => {
  it("sf-s27: never says it has everything; asks what happened", () => {
    const out = askCoachingWhatHappened(reply(LIVE, coaching("Thessaly Brandt")), "Thessaly Brandt", HISTORY);
    expect(out.content).not.toMatch(/Everything I need is here|I have the employee/);
    expect(out.content).toContain(COACHING_WHAT_HAPPENED_NOTE);
    expect(out.content).toMatch(/^Here is what I would put on a \*\*Coaching Form\*\*\./);
  });

  it("asks once per card", () => {
    const asked = [...HISTORY, { role: "user", content: "Thessaly Brandt" }, { role: "assistant", content: COACHING_WHAT_HAPPENED_NOTE }];
    const out = askCoachingWhatHappened(reply(LIVE, coaching("Thessaly Brandt")), "she keeps skipping the bed checks", asked);
    expect(out.content).toBe(LIVE);
  });
});

describe("controls: the card as built", () => {
  it("an account given", () => {
    const out = askCoachingWhatHappened(reply(LIVE, coaching("Thessaly Brandt")), "Thessaly Brandt was late opening the salon on Monday", HISTORY);
    expect(out.content).toBe(LIVE);
  });

  it("a team coaching card, and a Corrective Action card", () => {
    expect(askCoachingWhatHappened(reply(LIVE, coaching("The whole team", "team")), "the whole team", HISTORY).content).toBe(LIVE);
    const ca = { ...coaching("Thessaly Brandt"), templateKey: "dpoa", templateName: "Corrective Action Form" };
    expect(askCoachingWhatHappened(reply(LIVE, ca), "Thessaly Brandt", HISTORY).content).toBe(LIVE);
  });
});
