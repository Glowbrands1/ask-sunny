import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_INCIDENT_NOTE } from "@/lib/forms/corrective-action-intake";
import type { ChatFormProposal } from "@/types";

import { askCaWhatHappened } from "./ca-what-happened";
import type { AskResponse } from "./types";

/**
 * OMISSION_IS_ACCOUNT_ENABLED (Pau, 5 Nov 2026, sf-s28): "can i give a ca for
 * not signing off on the cleaning check list" → "can you write me a ca for
 * <name> from o street" was answered "You haven't told me what happened yet":
 * the account test read the "not" as "only what did not happen". The wording
 * is production's; the person is invented.
 */

const FLAG = "OMISSION_IS_ACCOUNT_ENABLED";
const NAME = "Thessaly Brandt";
const FIRST = "can i give a ca for not signing off on the cleaning check list";
const SECOND = `can you write me a ca for ${NAME} from o street`;
const LEAD = `I'll draft a **Corrective Action Form** for **${NAME}** from what you've described.`;

const card: ChatFormProposal = {
  proposalId: "p1",
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

const reply: AskResponse = { content: LEAD, citations: [], recommendedVideoIds: [], formProposal: card };
const history = (first: string) => [
  { role: "user", content: first },
  { role: "assistant", content: "A grounded answer." },
];
const ask = (first: string) => askCaWhatHappened(reply, SECOND, history(first)).content;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sf-s28: a duty not done, said a turn earlier", () => {
  it("off: asks what happened (the live report)", () => {
    expect(ask(FIRST)).toContain(NO_INCIDENT_NOTE);
  });

  it("on: the earlier turn is the account; nothing is asked", () => {
    vi.stubEnv(FLAG, "true");
    expect(ask(FIRST)).toBe(LEAD);
  });

  it("on: other duties not done are accounts too", () => {
    vi.stubEnv(FLAG, "true");
    expect(ask("she did not clock in for her shift")).toBe(LEAD);
    expect(ask("she never called in")).toBe(LEAD);
  });
});

describe("controls, on: only what did not happen still asks", () => {
  it.each(["she was not late", "not late", "she didn't do anything wrong", "nothing happened", "no incident"])("%s", (first) => {
    vi.stubEnv(FLAG, "true");
    expect(ask(first)).toContain(NO_INCIDENT_NOTE);
  });
});
