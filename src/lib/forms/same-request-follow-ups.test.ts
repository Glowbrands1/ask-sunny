import { afterEach, describe, expect, it } from "vitest";

import { EARLIER_CARD_STAYS, isProposalSuperseded } from "./proposal-continuation";
import { carriedAccount, sameRequestReadConversation } from "./same-request-other-person";

/*
 * QA's Sunny r19 live check (10 Nov 2026), the people invented (Rory Vance, Mara Quell). The replay cases
 * `nov10-same-request-carries-account` and `nov10-same-request-keeps-earlier-card` run the chat.
 */
afterEach(() => {
  delete process.env.SAME_REQUEST_OTHER_PERSON_ENABLED;
  delete process.env.SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED;
  delete process.env.NEXT_PUBLIC_SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED;
  delete process.env.SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED;
});

describe("SAME_REQUEST_CARRIES_ACCOUNT_ENABLED: <A>'s account with <B>'s name", () => {
  it.each([
    ["create a corrective action for Mara Quell, she was late on 11/3/26", "Mara Quell was late on 11/3/26"],
    ["create a corrective action for Mara Quell, she was late on 11/3/26\nWritten Warning.", "Mara Quell was late on 11/3/26"],
    ["write a CA for Mara Quell for being late to opening on 11/3/26", "Mara Quell for being late to opening on 11/3/26"],
  ])("%s → %s", (said, account) => {
    expect(carriedAccount(said, "Mara Quell")).toBe(account);
  });

  it("is nothing when the request carries no account", () => {
    expect(carriedAccount("create a corrective action for Mara Quell", "Mara Quell")).toBeNull();
  });
});

/*
 * SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED (port from Ask Bubbles' #696 gate: QA, group 4, Gate-Bubbles 961ab16c), the
 * overnight scan's sf-s11: "Odalys Frewen. Verbal Warning. Under Performance." then "Can you do the same thing for Perrin
 * Haldane but switch it to a written" carried "Perrin Haldane Written Warning. Under Performance".
 */
describe("SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED: a name, a level and a bare topic are not an account", () => {
  const SF_S11 = [
    "Odalys Frewen. Verbal Warning. Under Performance.",
    "Perrin Haldane. Verbal Warning. Under Performance.",
    "Verbal Warning. Under Performance.",
    "Written Warning. Under Performance",
    "create a corrective action for Perrin Haldane, written warning, attendance",
  ];

  it("off (production today): sf-s11 carries the level and the topic", () => {
    expect(carriedAccount("Perrin Haldane. Verbal Warning. Under Performance.", "Perrin Haldane")).toMatch(/Warning/);
  });

  it.each(SF_S11)("on: %s carries nothing", (said) => {
    process.env.SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED = "true";
    expect(carriedAccount(said, "Perrin Haldane")).toBeNull();
  });

  it("on: a level word inside the account is dropped, the account kept", () => {
    process.env.SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED = "true";
    expect(carriedAccount("create a corrective action for Mara Quell, verbal warning, she was late on 11/3/26", "Mara Quell")).toBe("Mara Quell was late on 11/3/26");
  });

  it.each([
    ["create a corrective action for Mara Quell, she was late on 11/3/26", "Mara Quell was late on 11/3/26"],
    ["create a corrective action for Mara Quell, she was late on 11/3/26\nWritten Warning.", "Mara Quell was late on 11/3/26"],
    ["write a CA for Mara Quell for being late to opening on 11/3/26", "Mara Quell for being late to opening on 11/3/26"],
  ])("on: a real account is carried as before: %s", (said, account) => {
    process.env.SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED = "true";
    expect(carriedAccount(said, "Mara Quell")).toBe(account);
  });
});

describe("SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED: both cards stay creatable", () => {
  const turns = [
    { role: "user", content: "create a corrective action for Rory Vance, she was late on 11/3/26" },
    { role: "assistant", content: "card for Rory" },
    { role: "user", content: "Can you do the same thing for Mara Quell but make it a written" },
    { role: "assistant", content: "card for Mara" },
  ];

  it("Create reads <A>'s card as the chat stood before \"the same thing for <B>\"", () => {
    process.env.SAME_REQUEST_OTHER_PERSON_ENABLED = "true";
    expect(sameRequestReadConversation(turns, "Rory Vance")).toEqual(turns.slice(2));
    process.env.SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED = "true";
    expect(sameRequestReadConversation(turns, "Rory Vance")).toEqual(turns.slice(0, 2));
    expect(sameRequestReadConversation(turns, "Mara Quell")).toEqual(turns.slice(2));
  });

  it("<B>'s card does not supersede <A>'s; a card for the same person, or without the sentence, still does", () => {
    const card = (id: string, employeeName: string) => ({ proposalId: id, employeeName, templateKey: "dpoa" }) as never;
    const chat = [
      { id: "a1", role: "assistant", content: "Rory's card", formProposal: card("p-rory", "Rory Vance") },
      { id: "a2", role: "assistant", content: `A new card for **Mara Quell** … ${EARLIER_CARD_STAYS}`, formProposal: card("p-mara", "Mara Quell") },
    ] as never[];
    expect(isProposalSuperseded(chat, "p-rory")).toBe(true);
    process.env.NEXT_PUBLIC_SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED = "true";
    expect(isProposalSuperseded(chat, "p-rory")).toBe(false);
    const corrected = [chat[0], { id: "a2", role: "assistant", content: "Here is the card for Mara Quell.", formProposal: card("p-mara", "Mara Quell") }] as never[];
    expect(isProposalSuperseded(corrected, "p-rory")).toBe(true);
  });
});
