import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { ASK_WHO, rosterOnlyNames } from "./roster-only-names";

/**
 * ROSTER_NEAR_MISS_ENABLED (port from the sibling app; QA's testers there, 5 Nov
 * 2026, R3/R5/R7, flags on). The
 * shapes are QA's ("the reply names the person in the Action Plan, then asks
 * 'Who is this form for?'", "I can create a CA for [A]", "Name: [B]" while the
 * card is empty); every person is invented.
 */

const ROSTER = ["Marnie Holloway", "Remy Calder", "Ignatius Wexlerby"];

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ROSTER_NEAR_MISS_ENABLED (a): a near-miss of one roster name is asked, never dropped", () => {
  it("off: the near-miss is taken off the card and the reply asks who (as before)", () => {
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **Ignatius Wexlarby** from what you've described.", "Ignatius Wexlarby"), ROSTER);
    expect(out.formProposal?.employeeName ?? null).toBeNull();
  });

  it("on: \"Ignatius Wexlarby\" (one letter wrong) is asked as \"Is this for **Ignatius Wexlerby**?\", the first-name question; the card waits", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const out = rosterOnlyNames(reply("I'll draft a **Corrective Action Form** for **Ignatius Wexlarby** from what you've described.\n\n**Action plan:** Management will review the applicable company policy with Ignatius.", "Ignatius Wexlarby"), ROSTER);
    expect(out.content).toBe("Is this for **Ignatius Wexlerby**? Tell me if that should change.");
    expect(out.formProposal).toBeUndefined();
  });
});

describe("ROSTER_NEAR_MISS_ENABLED: the sibling app's combined pre-check, its two regressions (5 Nov 2026)", () => {
  it("\"I need a corrective action for Coaching Form. …\": a form's name is never the person, so \"**Corrective Action Form**\" is never \"**Corrective Action the employee\"", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const out = rosterOnlyNames(
      reply("Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name", null),
      ROSTER,
      "I need a corrective action for Coaching Form. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.",
    );
    expect(out.content).toContain("**Corrective Action Form**");
    expect(out.content).not.toMatch(/the employee\. To get started/);
  });

  it("a reply whose list already asks \"1. Employee's full name\" is not asked \"Who is this form for?\" again", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const text = "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:\n\n1. Employee's full name\n2. Date for the form";
    const out = rosterOnlyNames(reply(text, null), ROSTER, "create a corrective action form");
    expect(out.content).not.toContain(ASK_WHO);
  });
});

describe("ROSTER_NEAR_MISS_ENABLED (b): with no employee on the card, no reply text names them", () => {
  const message = "create a CA for Zebulon Marchbanks, he was late opening the salon on 11/2";

  it("off: \"I can create a CA for …\", \"Name: …\" and the Action plan keep the name (as before)", () => {
    const out = rosterOnlyNames(reply("I can create a CA for Zebulon Marchbanks.\n\nName: Zebulon Marchbanks\n\n**Action plan:** Zebulon will be on time for every opening shift.", null), ROSTER, message);
    expect(out.content).toMatch(/Zebulon/);
  });

  it("on: none of them names him; it asks who", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const out = rosterOnlyNames(reply("I can create a CA for Zebulon Marchbanks.\n\nName: Zebulon Marchbanks\n\n**Action plan:** Zebulon will be on time for every opening shift.", null), ROSTER, message);
    expect(out.content).not.toMatch(/Zebulon|Marchbanks/);
    expect(out.content).not.toMatch(/^\s*Name:/m);
    expect(out.content).toContain("**Action plan:** The employee will be on time for every opening shift.");
    expect(out.content).toContain(ASK_WHO);
  });

  it("on: the person the reply drafts for, typed in lowercase (\"… for **zebulon marchbanks**\"), is named nowhere, in any case", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const out = rosterOnlyNames(
      reply("I'll draft a **Corrective Action Form** for **zebulon marchbanks** from what you've described.\n\n**Action Plan:** zebulon will be on time for every opening shift", null),
      ROSTER,
      "create a CA for zebulon marchbanks, he was late opening the salon on 11/2",
    );
    expect(out.content).not.toMatch(/zebulon|marchbanks/i);
    expect(out.content).toContain("**Action Plan:** The employee will be on time for every opening shift");
  });

  it("on: the line that says why (\"I couldn't find **<name>** …\") and a choice of roster people keep their names", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    const out = rosterOnlyNames(
      reply("I couldn't find **Zebulon Marchbanks** in the Woven roster, so that name is not on the form.\n\nWhich of them is this **Corrective Action Form** for — **Marnie Holloway** or **Remy Calder**?", null),
      ROSTER,
      message,
    );
    expect(out.content).toContain("I couldn't find **Zebulon Marchbanks** in the Woven roster");
    expect(out.content).toContain("**Marnie Holloway** or **Remy Calder**");
    expect(out.content).not.toContain(ASK_WHO);
  });
});
