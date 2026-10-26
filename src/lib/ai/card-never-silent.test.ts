import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { CREATE_DRAFT_LINE, withCardNeverSilent } from "./card-never-silent";
import type { AskRequest, AskResponse } from "./types";

/**
 * Ask Sunny conv_mvoenhk42lu3cxo, 25 Oct 2026. The manager's turns are copied
 * exactly, typos included; the employee's name is invented (Wynn Talbot).
 * Each turn below got the card reply back word for word, with nothing that
 * answered it.
 */
const FLAG = "CARD_NEVER_SILENT_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const CARD_REPLY = [
  "I'll draft a **Corrective Action Form** for **Wynn Talbot** from what you've described, and check the applicable company policy before anything policy-related goes on it.",
  "",
  "**Policy:** Late Opening, as you said. I'll quote that section from the current policy manual on the draft.",
].join("\n");

const CARD: ChatFormProposal = {
  proposalId: "prop-1",
  supportsInlineDraft: true,
  templateKey: "dpoa",
  templateName: "Corrective Action Form",
  variantKey: null,
  employeeName: "Wynn Talbot",
  employeeRole: null,
  locationId: "salon-1",
  locationName: null,
  locationResolution: "resolved",
  authorizedLocationIds: [],
  status: "ready",
  sourceMessageIds: [],
};

const HISTORY = [
  { id: "m0", role: "user", content: "Can you please write a ca for me for wynn talbot for not opening the salon on time and not being able to come to her shift" },
  { id: "m1", role: "assistant", content: CARD_REPLY, formProposal: CARD },
];

function turn(question: string, response: AskResponse = { content: CARD_REPLY, citations: [], formProposal: CARD } as unknown as AskResponse) {
  return withCardNeverSilent(response, { question, history: HISTORY } as unknown as AskRequest);
}

const REPORTED = [
  "i verified everythign i jsut need to finalize it",
  "i need to edit this can you make it to where i can edit",
  "can you make the form the same way again",
  "Create a Corrective Action Form from this conversation.",
  "Yes",
];

describe("CARD_NEVER_SILENT_ENABLED off", () => {
  it.each(REPORTED)("returns the same reply as main for %s", (question) => {
    delete process.env[FLAG];
    expect(turn(question).content).toBe(CARD_REPLY);
  });
});

describe("CARD_NEVER_SILENT_ENABLED on", () => {
  it.each(REPORTED)("answers %s instead of repeating the card", (question) => {
    process.env[FLAG] = "on";
    const out = turn(question);
    expect(out.content).not.toBe(CARD_REPLY);
    expect(out.content).toContain("**Create draft**");
    expect(out.content.endsWith(CARD_REPLY)).toBe(true);
    expect(out.formProposal).toBe(CARD);
  });

  it("tells a manager who wants to finalize to press Create draft, then Finalize on the form", () => {
    process.env[FLAG] = "on";
    expect(turn("i verified everythign i jsut need to finalize it").content.startsWith(CREATE_DRAFT_LINE)).toBe(true);
    expect(turn("i need to edit this can you make it to where i can edit").content).toMatch(/^To edit it, press \*\*Create draft\*\*.*\*\*Finalize\*\* is a button on the form/);
  });

  it("speaks when the card reply is empty", () => {
    process.env[FLAG] = "on";
    const out = turn("Yes", { content: "", citations: [], formProposal: CARD } as unknown as AskResponse);
    expect(out.content).toBe(CREATE_DRAFT_LINE);
  });

  it("leaves a reply that already changed alone", () => {
    process.env[FLAG] = "on";
    const changed = { content: `${CARD_REPLY}\n\n**Type of Warning:** Verbal Warning, as you said.`, citations: [], formProposal: CARD } as unknown as AskResponse;
    expect(turn("verbal", changed)).toBe(changed);
  });
});

/** QA, 26 Oct 2026 (both apps): "ca" alone opened a blank card with no text. */
describe("CARD_NEVER_SILENT_ENABLED on: a bare form word asks for the facts", () => {
  const BLANK = { ...CARD, employeeName: null, status: "needs_employee", supportsInlineDraft: false } as ChatFormProposal;

  it.each(["ca", "Ca", "CA", "coach", "Coaching", "EXIT", "exit form", "a ca", "write up"])("'%s' with an empty card asks who and what happened", (word) => {
    process.env[FLAG] = "on";
    const out = withCardNeverSilent({ content: "", citations: [], formProposal: BLANK } as unknown as AskResponse, { question: word, history: [] } as unknown as AskRequest);
    expect(out.content).toBe(
      "Who is this **Corrective Action Form** for, and what happened? Tell me their name, the date and what they did, and I'll fill in the card.",
    );
    expect(out.formProposal).toBe(BLANK);
  });

  it("a reply that already says something is left as it is", () => {
    process.env[FLAG] = "on";
    const response = { content: "Who is this **Corrective Action Form** for?", citations: [], formProposal: BLANK } as unknown as AskResponse;
    expect(withCardNeverSilent(response, { question: "ca", history: [] } as unknown as AskRequest)).toBe(response);
  });
});
