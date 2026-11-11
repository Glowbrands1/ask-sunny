import { afterEach, describe, expect, it } from "vitest";

import { salonById } from "@/data/salons";
import type { ChatFormProposal } from "@/types";

import { SALON_QUESTION, withStoreChoicesNamed } from "./store-choices-named";

/** STORE_CHOICES_NAMED_ENABLED (ported from Ask Bubbles: Problem 20, 10 Nov 2026). The person is invented. */
const FLAG = "STORE_CHOICES_NAMED_ENABLED";
const A = salonById("loc-0307")!.name;
const B = salonById("loc-0309")!.name;

function card(extra: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "p",
    templateKey: "coaching",
    templateName: "Coaching Form",
    status: "needs_location",
    employeeName: "Wren Tallis",
    locationResolution: "needs_selection",
    authorizedLocationIds: ["loc-0307", "loc-0309"],
    ...extra,
  } as ChatFormProposal;
}

const reply = (formProposal: ChatFormProposal) => ({ content: `Here is what I would put on a **Coaching Form**.\n\n${SALON_QUESTION}`, formProposal });

afterEach(() => {
  delete process.env[FLAG];
});

describe("STORE_CHOICES_NAMED (salons)", () => {
  it("flag off (as before): the bare question", () => {
    expect(withStoreChoicesNamed(reply(card())).content).toContain(SALON_QUESTION);
  });

  it("flag on: the manager's salons are named", () => {
    process.env[FLAG] = "true";
    expect(withStoreChoicesNamed(reply(card())).content).toContain(`I won't choose which salon this belongs to. Is it **${A}** or **${B}**?`);
  });

  it("flag on, NEVER-BREAK: a named out-of-scope salon, or a resolved card, is left as it is", () => {
    process.env[FLAG] = "true";
    expect(withStoreChoicesNamed(reply(card({ namedLocationOutOfScope: "Elsewhere" }))).content).toContain(SALON_QUESTION);
    expect(withStoreChoicesNamed(reply(card({ locationResolution: "resolved" }))).content).toContain(SALON_QUESTION);
  });
});
