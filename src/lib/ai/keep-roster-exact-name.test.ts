import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import type { GroundedPerson } from "./grounded-entities";
import { holdFilledSlots } from "./keep-filled-slots";
import type { AskResponse } from "./types";

/**
 * KEEP_ROSTER_EXACT_NAME_ENABLED (QA, 4 Nov 2026). Live: Pau's message 1 for
 * the QA test account's own roster entry, a name ending in "One". The reply
 * said "I'll draft a Corrective Action Form for <name>" and the card's
 * Employee was empty: the slot keeper read the name as a fragment ("one" is a
 * not-a-name word) and took it off the card after the reply was written.
 *
 * On: an exact roster name stays on the card, in the roster's spelling; a
 * name the keeper still takes off the card is not drafted for in the reply,
 * which asks who the form is for. The entry is invented, the same shape.
 */

const FLAG = "KEEP_ROSTER_EXACT_NAME_ENABLED";
const TODAY = "2026-11-04";
const NAME = "QA Probe XZT One";
const QUESTION = `I need a corrective action verbal for ${NAME}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`;
const LEAD = `I'll draft a **Corrective Action Form** for **${NAME}** from what you've described, and check the applicable company policy before anything policy-related goes on it.`;

const ENTRY: GroundedPerson = {
  id: "e-qa-probe",
  firstName: "QA Probe",
  lastName: "XZT One",
  preferredFirstName: null,
  salonIds: ["loc-0309"],
  title: "Tanning Consultant",
  primaryLocationName: "Kearney",
};

const card: ChatFormProposal = {
  proposalId: "prop-1",
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

const answer: AskResponse = { content: LEAD, citations: [], recommendedVideoIds: [], formProposal: card };

const hold = (people: readonly GroundedPerson[]) => holdFilledSlots({ response: answer, question: QUESTION, history: [], today: TODAY, people });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a roster name with a not-a-name word in it", () => {
  it("off: the keeper takes it off the card, and the reply still drafts for it (the live report)", () => {
    /*
     * FORM_NAME_FROM_ROSTER_ENABLED off too, explicitly: with it on (production
     * since 5 Nov 2026), #531 runs the same reply rewrite, so this pin of the
     * live report holds only with both flags off.
     */
    vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "");
    const held = hold([ENTRY]);
    expect(held.formProposal?.employeeName ?? null).toBeNull();
    expect(held.content).toContain(`**${NAME}**`);
  });

  it("on: an exact roster name stays on the card", () => {
    vi.stubEnv(FLAG, "true");
    expect(hold([ENTRY]).formProposal?.employeeName).toBe(NAME);
  });

  it("on: typed in another case, the card has the roster's spelling", () => {
    vi.stubEnv(FLAG, "true");
    const held = holdFilledSlots({
      response: { ...answer, formProposal: { ...card, employeeName: "qa probe xzt one" } },
      question: QUESTION.replace(NAME, "qa probe xzt one"),
      history: [],
      today: TODAY,
      people: [ENTRY],
    });
    expect(held.formProposal?.employeeName).toBe(NAME);
  });

  it("on, not on the roster: off the card, and the reply asks who instead of drafting for it", () => {
    vi.stubEnv(FLAG, "true");
    const held = hold([]);
    expect(held.formProposal?.employeeName ?? null).toBeNull();
    expect(held.content).not.toContain(`**${NAME}**`);
    expect(held.content).toMatch(/I'll draft a \*\*Corrective Action Form\*\* from what you've described/);
    expect(held.content).toMatch(/Who is this form for\?/);
  });
});
