import { describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { ASK_WHO, rosterOnlyNames, rosterSpelling } from "./roster-only-names";

/**
 * Pau, 5 Nov 2026 (FORM_NAME_FROM_ROSTER_ENABLED): only roster people are ever
 * the card's employee or a choice. The reply lines are production's; the
 * people are invented.
 */

const ROSTER = ["Dana Lane", "Ima Employee", "Odalys Merriwether", "Perpetua Thornquist"];

function card(employeeName: string | null): ChatFormProposal {
  return {
    proposalId: "p1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
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
  };
}

const reply = (content: string, employee: string | null): AskResponse => ({ content, citations: [], recommendedVideoIds: [], formProposal: card(employee) });

describe("the card's employee", () => {
  it("a roster name typed in any case takes the roster's spelling", () => {
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **odalys merriwether** from what you've described.", "odalys merriwether"), ROSTER);
    expect(out.formProposal?.employeeName).toBe("Odalys Merriwether");
    expect(out.content).toContain("for **Odalys Merriwether**");
  });

  it("a name on no roster is not the employee: no card name, and the reply asks who once", () => {
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **Ima** from what you've described.", "Ima"), ["Dana Lane"]);
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.formProposal?.status).toBe("needs_employee");
    expect(out.content).not.toContain("**Ima**");
    expect(out.content.split(ASK_WHO)).toHaveLength(2);
  });

  it("a first name that is one roster person's is asked about, never put on the card", () => {
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **Perpetua** from what you've described.", "Perpetua"), ROSTER);
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.content).toContain("Is this for **Perpetua Thornquist**?");
  });

  it("the opening line names the card's roster person", () => {
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **ima** from what you've described.", "Ima Employee"), ROSTER);
    expect(out.content).toContain("for **Ima Employee**");
  });
});

describe("the choices", () => {
  // The coordinator's message 8, live with the flags on: the card's Employee was right; the reply offered metrics.
  const MESSAGE_8 =
    "I'll draft a **Corrective Action Form** for **Dana Lane** from what you've described.\n\nWhich of them is this **Corrective Action Form** for — **Dana Lane**, **LPSVA** or **Average Club**?";

  it("message 8: the metrics are never offered; the card's own person needs no question", () => {
    const out = rosterOnlyNames(reply(MESSAGE_8, "Dana Lane"), ROSTER);
    expect(out.content).not.toMatch(/LPSVA|Average Club/);
    expect(out.content).not.toMatch(/Which of them/);
    expect(out.formProposal?.employeeName).toBe("Dana Lane");
  });

  it("a choice keeps roster people only; one left with no employee on the card is asked about", () => {
    const out = rosterOnlyNames(reply("Which of them is this **Corrective Action Form** for — **Remy Fenn**, **Club Close** or **Dana Lane**?", null), ROSTER);
    expect(out.content).toBe("Is this for **Dana Lane**?");
  });

  it("two roster people stay a choice; nobody left becomes the question who", () => {
    expect(rosterOnlyNames(reply("Which of them is this **Corrective Action Form** for — **Dana Lane**, **Under** or **Ima Employee**?", null), ROSTER).content).toBe(
      "Which of them is this **Corrective Action Form** for — **Dana Lane** or **Ima Employee**?",
    );
    expect(rosterOnlyNames(reply("Which of them is this **Corrective Action Form** for — **Club Close** or **Under**?", null), ROSTER).content).toBe(ASK_WHO);
  });

  it("\"Is this for X?\" stands for a roster person only", () => {
    expect(rosterOnlyNames(reply("Is this for **Coaching Form**?", null), ROSTER).content).toBe(ASK_WHO);
    expect(rosterOnlyNames(reply("Is this for **Dana Lane**?", null), ROSTER).content).toBe("Is this for **Dana Lane**?");
  });
});

describe("no roster read this turn", () => {
  it("the reply as built", () => {
    const built = reply("I'll draft a **Corrective Action Form** for **Ima** from what you've described.", "Ima");
    expect(rosterOnlyNames(built, [])).toBe(built);
    expect(rosterSpelling("ima employee", ROSTER)).toBe("Ima Employee");
  });
});
