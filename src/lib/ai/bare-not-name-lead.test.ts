import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { replyMatchesCard } from "./reply-matches-card";
import type { AskResponse } from "./types";

/**
 * BARE_NOT_NAME_LEAD_ENABLED (Coding's bisect, 7 Nov 2026). With REPLY_MATCHES_CARD on, "ca for <A> not late" lost
 * "You haven't told me what happened yet": the card's Observation led with the employee's name. Invented people.
 */
const ROSTER = ["Rowan Kestrel", "Marnie Holloway"];
const ASK = "**You haven't told me what happened yet**, so I can't cite the policy manual.";

function card(employeeName: string, issue: string | null = null): ChatFormProposal {
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
    status: "ready",
    sourceMessageIds: [],
    ...(issue ? { issue } : {}),
  } as ChatFormProposal;
}
const reply = (observation: string, proposal: ChatFormProposal): AskResponse => ({
  content: `I'll draft a **Corrective Action Form** for **${proposal.employeeName}**.\n\n${ASK}\n\n**Observation of Offense:** ${observation}`,
  citations: [],
  recommendedVideoIds: [],
  formProposal: proposal,
});
const asks = (observation: string, employee = "Rowan Kestrel") =>
  replyMatchesCard(reply(observation, card(employee)), ROSTER, `ca for ${employee} not late`).content.includes("haven't told me what happened");

describe("BARE_NOT_NAME_LEAD_ENABLED", () => {
  beforeEach(() => vi.stubEnv("BARE_NOT_DENIAL_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("off: \"<A> not late\" on the card drops the ask (the reported composition bug)", () => {
    expect(asks("Rowan Kestrel not late")).toBe(false);
  });

  it.each(["Rowan Kestrel not late", "Rowan not late", "rowan kestrel, not late", "Rowan's not late"])('on: "%s" keeps the ask', (observation) => {
    vi.stubEnv("BARE_NOT_NAME_LEAD_ENABLED", "true");
    expect(asks(observation)).toBe(true);
  });

  it.each(["Rowan Kestrel was late on 11-2-26", "Rowan Kestrel not late but left the bed dirty", "Marnie Holloway not late"])(
    'on: "%s" is still an account (or another person\'s line): the ask goes, as before',
    (observation) => {
      const off = asks(observation);
      vi.stubEnv("BARE_NOT_NAME_LEAD_ENABLED", "true");
      expect(asks(observation)).toBe(off);
      expect(asks(observation)).toBe(false);
    },
  );

  it("on, without BARE_NOT_DENIAL: nothing changes", () => {
    vi.stubEnv("BARE_NOT_DENIAL_ENABLED", "false");
    const off = asks("Rowan Kestrel not late");
    vi.stubEnv("BARE_NOT_NAME_LEAD_ENABLED", "true");
    expect(asks("Rowan Kestrel not late")).toBe(off);
  });
});
