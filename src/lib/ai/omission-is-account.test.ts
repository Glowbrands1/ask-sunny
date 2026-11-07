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

/*
 * QA's Sunny gate, 6 Nov 2026: with CA_SALES_POLICY_ENABLED on, the bare "not late" control was read
 * as the account (a Corrective Action drafted, no "You haven't told me what happened"). The denial
 * reader knew "never late" / "wasn't late", not a clause that starts with "not". With
 * BARE_NOT_DENIAL_ENABLED on, "not <fault>" at the start of a clause is a denial too; "not meeting
 * sales requirements" (no fault word) is still the account.
 */
describe("BARE_NOT_DENIAL_ENABLED: with CA_SALES on, a bare \"not late\" still asks", () => {
  const on = (bare: boolean) => {
    vi.stubEnv(FLAG, "true");
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("BARE_NOT_DENIAL_ENABLED", bare ? "true" : "");
  };
  it("off: \"not late\" is read as the account (the gate's finding)", () => {
    on(false);
    expect(ask("not late")).not.toContain(NO_INCIDENT_NOTE);
  });
  it.each(["not late", "not tardy", "not absent", "Not late."])("on: %s still asks what happened", (first) => {
    on(true);
    expect(ask(first)).toContain(NO_INCIDENT_NOTE);
  });
  it.each(["not meeting sales requirements", "not completing her woven courses by the deadline"])("on: %s is still the account", (first) => {
    on(true);
    expect(ask(first)).not.toContain(NO_INCIDENT_NOTE);
  });
});
