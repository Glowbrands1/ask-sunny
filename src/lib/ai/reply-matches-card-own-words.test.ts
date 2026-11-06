import { describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { replyMatchesCard } from "./reply-matches-card";
import type { AskResponse } from "./types";

/**
 * REPLY_MATCHES_CARD_ENABLED, rule 1 (no employee on the card): the name taken off the card is "the employee" in
 * every line — but only the NAME, never the app's own words. Ported from the sibling app (Ask-bubbles#478). Found by this app's METRIC_GUARD side-effect
 * run (5 Nov 2026): QA's probe "QA Probe XZT One" turned "One more question: **Is payroll deduct applicable?**"
 * into "The employee more question". QA: a real roster person in the sibling app has a preferred first name that is an ordinary
 * word, so a "Will"- or "Hope"-type first name would do the same in production. Invented people (checked against
 * both apps' directories).
 */
const ROSTER = ["Marnie Holloway", "Remy Calder"];

function card(): ChatFormProposal {
  return {
    proposalId: "p1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: null,
    employeeRole: null,
    formDate: null,
    locationId: "loc-0309",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: ["loc-0309"],
    status: "needs_employee",
    sourceMessageIds: [],
  };
}

const reply = (content: string): AskResponse => ({ content, citations: [], recommendedVideoIds: [], formProposal: card() });

describe("REPLY_MATCHES_CARD rule 1: the removed name goes, the app's own words stay", () => {
  it("QA's probe: \"QA Probe XZT One\" never rewrites \"One more question\"", () => {
    const out = replyMatchesCard(
      reply("I'll draft a **Corrective Action Form** for **QA Probe XZT One** from what you've described.\n\nOne more question: **Is payroll deduct applicable?** Yes or No?"),
      ROSTER,
      "I need a corrective action verbal for QA Probe XZT One. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.",
    ).content;
    expect(out).toContain("One more question: **Is payroll deduct applicable?**");
    expect(out).not.toContain("The employee more question");
    expect(out).not.toMatch(/QA Probe XZT One/);
  });

  const MESSAGE = "create a ca form for Will Drummet, he was late opening the salon on 11/2";
  const TEXT = [
    "I'll draft a **Corrective Action Form** for **Will Drummet** from what you've described.",
    "",
    "Will you want payroll deduct on it? Yes or No.",
    "",
    "**Action plan:** Management will review the late-opening policy with Will. Will Drummet will be on time.",
  ].join("\n");

  it("a common-word first name at the start of a line (\"Will you want …\") is the app's word: kept", () => {
    expect(replyMatchesCard(reply(TEXT), ROSTER, MESSAGE).content).toContain("Will you want payroll deduct on it?");
  });

  it("the same word in another case mid-sentence (\"Management will review\") is the app's word: kept", () => {
    expect(replyMatchesCard(reply(TEXT), ROSTER, MESSAGE).content).toContain("Management will review");
  });

  it("the name word mid-sentence (\"with Will\") and the whole name are the employee: scrubbed", () => {
    const out = replyMatchesCard(reply(TEXT), ROSTER, MESSAGE).content;
    expect(out).toContain("with the employee.");
    expect(out).not.toMatch(/Will Drummet|Drummet/);
    expect(out).toContain("The employee will be on time.");
  });

  it("a name word after a colon is a field's value, not a sentence start: scrubbed (\"action plan: Zebulon will …\")", () => {
    const out = replyMatchesCard(
      reply("I'll draft a **Corrective Action Form** for **Zebulon Marchbanks** from what you've described.\n\n**Observation of Offense:** he was late. action plan: Zebulon will be on time for every opening shift"),
      ROSTER,
      "create a CA for Zebulon Marchbanks, he was late opening on 11/2. action plan: Zebulon will be on time for every opening shift",
    ).content;
    expect(out).not.toMatch(/Zebulon|Marchbanks/);
  });

  it("a name typed in lowercase (\"zebulon marchbanks\") is still scrubbed in every case, as before", () => {
    const out = replyMatchesCard(
      reply("I'll draft a **Corrective Action Form** for **zebulon marchbanks** from what you've described.\n\n**Action Plan:** zebulon will be on time for every opening shift"),
      ROSTER,
      "create a CA for zebulon marchbanks, he was late opening the salon on 11/2",
    ).content;
    expect(out).not.toMatch(/zebulon|marchbanks/i);
  });
});
