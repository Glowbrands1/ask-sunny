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

/*
 * THE SALES-FLIP GATE (ask-sunny#530, 5 Nov 2026): the employee is taken off
 * after the reply is built, so the rest of the reply must not speak for them.
 * The replies are the gate's rows, verbatim (replay records, flags on).
 */
describe("the gate's regressions: nothing in the reply speaks for a removed employee", () => {
  const STREET_TURN_2 =
    "Here is what I would put on a **Coaching Form**.\n\nEverything I need is here, drawn from your messages above.\n\nI have the employee and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.\n\nPrior coaching is optional. No finalized record is in this app and no note was given, so the line stays blank. The draft can still be created.\n\nAttendance Policy, JBA Policy Manual p.14\n\n**Date:** 10/26/2026\n\n**Observation of Offense:** <name>, she was late today";
  const IMA =
    "Who is this **Corrective Action Form** for? Give me their name and I'll draft it from what you've told me — you can set the warning level and anything else on the form itself.\n\nLate Opening Policy, JBA Policy Manual p.15\n\n**Date:** 9/28/2026\n\n**Observation of Offense:** ima employee, opening salon late on 9-28-26";

  it("nov3-street-then-placeholder: the removed employee's \"Everything I need is here … I have the employee and the salon\" goes", () => {
    const coaching = { ...reply(STREET_TURN_2, "Main Street"), formProposal: { ...card("Main Street"), templateKey: "coaching", templateName: "Coaching Form" } };
    const out = rosterOnlyNames(coaching, ["Dana Lane"], "make a coaching form for <name>, she was late today");
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.content).not.toMatch(/Everything I need is here|I have the employee/);
    expect(out.content).not.toMatch(/Create the draft here when you're ready/);
    expect(out.content).toContain(ASK_WHO);
    expect(out.content).toContain("**Observation of Offense:** she was late today");
  });

  it("nov5-roster-only-ima-off-roster: the request's \"for ima employee,\" never opens the Observation", () => {
    const out = rosterOnlyNames(reply(IMA, null), ["Dana Lane"], "create a CA form for ima employee, for opening salon late on 9-28-26");
    expect(out.content).toContain("**Observation of Offense:** opening salon late on 9-28-26");
    expect(out.content).not.toMatch(/\bima\b/);
  });

  it("a card's roster person, a name later in the account, or no message: the Observation stays as built", () => {
    const onCard = "I'll draft a **Corrective Action Form** for **Dana Lane**.\n\n**Observation of Offense:** Dana Lane, opened late on 9-28-26";
    expect(rosterOnlyNames(reply(onCard, "Dana Lane"), ["Dana Lane"], "create a CA for Dana Lane, opened late on 9-28-26").content).toBe(onCard);
    const later = IMA.replace("ima employee, opening salon late", "opening salon late, ima employee said");
    expect(rosterOnlyNames(reply(later, null), ["Dana Lane"], "create a CA form for ima employee, for opening salon late on 9-28-26").content).toContain("opening salon late, ima employee said");
    expect(rosterOnlyNames(reply(IMA, null), ["Dana Lane"]).content).toContain("ima employee, opening salon late");
  });

  it("a roster person who opens the account is the account's, even with no card name", () => {
    const text = IMA.replace("ima employee, opening", "Dana Lane, opening");
    expect(rosterOnlyNames(reply(text, null), ["Dana Lane"], "create a CA form for Dana Lane, for opening salon late on 9-28-26").content).toContain("Dana Lane, opening");
  });
});
