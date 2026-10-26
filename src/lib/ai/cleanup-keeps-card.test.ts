import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { withCleanupKeepsCard } from "./cleanup-keeps-card";
import type { AskRequest, AskResponse } from "./types";

/**
 * QA live run, 26 Oct 2026 (tester 1, conv_mvoxjzum2k8ad8a lowercase,
 * conv_mvoxjzji2054um1 sentence case; the tester's wording, name invented).
 */
const FLAG = "CLEANUP_REQUEST_KEEPS_CARD_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const T1 = "create a ca for rory vance at lawrence, she was late on 10-5 and 10-15. i coached her on 10-16 about being late";
const CARD = { proposalId: "p1", templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Rory Vance", sourceMessageIds: ["m0"], status: "ready" } as unknown as ChatFormProposal;
const CARD_REPLY = "Here is what I would put on a **Corrective Action Form**.\n\n**Observation of Offense:** she was late on 10-5 and 10-15.";
const HISTORY = [
  { id: "m0", role: "user", content: T1 },
  { id: "m1", role: "assistant", content: CARD_REPLY, formProposal: CARD },
];
// What the readers made of the turn: the card lost, or re-issued with the request read into the account.
const LOST = { content: "Here's your text cleaned up: … The form has not been created yet.", citations: [] } as unknown as AskResponse;
const GLUED = {
  content: "**Observation of Offense:** i coached her on 10-16 about being late can you clean up my grammar and capitalizing on proper nouns?",
  citations: [],
  formProposal: { ...CARD, sourceMessageIds: ["m0", "m2"], formDate: "2025-10-16" },
} as unknown as AskResponse;
const ask = (question: string) => ({ question, history: HISTORY }) as unknown as AskRequest;

describe("CLEANUP_REQUEST_KEEPS_CARD_ENABLED off", () => {
  it("returns the reply as it is, as on main", () => {
    delete process.env[FLAG];
    expect(withCleanupKeepsCard(LOST, ask("can you clean up my grammar and capitalizing on proper nouns?"))).toBe(LOST);
  });
});

describe("CLEANUP_REQUEST_KEEPS_CARD_ENABLED on", () => {
  it.each([
    "can you clean up my grammar and capitalizing on proper nouns?",
    "Can you clean up my grammar and capitalizing on proper nouns?",
    "CAN YOU CLEAN UP MY GRAMMAR AND CAPITALIZING ON PROPER NOUNS?",
    "please fix my spelling",
    "proofread it",
    "can you capitalize the names",
    "thanks",
    "ok thank you!",
  ])("'%s' keeps the same card, fields and source turns", (question) => {
    process.env[FLAG] = "on";
    for (const response of [LOST, GLUED]) {
      const out = withCleanupKeepsCard(response, ask(question));
      expect(out.formProposal).toBe(CARD);
      expect(out.formProposal?.sourceMessageIds).toEqual(["m0"]);
      expect(out.content).toContain("she was late on 10-5 and 10-15.");
      expect(out.content).toContain("The card below is unchanged");
      expect(out.content).not.toContain("can you clean up");
    }
  });

  it.each(["do not clean up my grammar", "Don't fix my spelling, it's fine"])("'%s' keeps the card too, without offering the rewrite", (question) => {
    process.env[FLAG] = "on";
    const out = withCleanupKeepsCard(GLUED, ask(question));
    expect(out.formProposal).toBe(CARD);
    expect(out.content).not.toContain("full sentences");
  });

  it.each([
    "clean up the grammar and change it to a written warning",
    "fix the spelling of her name, it's Rory Vanse",
    "clean up the grammar on tom lee's form",
    "fix my grammar and add that she was late on 10-20",
    "what does the policy say about being late?",
    "make it a verbal",
  ])("'%s' is left to the readers", (question) => {
    process.env[FLAG] = "on";
    expect(withCleanupKeepsCard(GLUED, ask(question))).toBe(GLUED);
  });

  it("no card before: the reply is as it is", () => {
    process.env[FLAG] = "on";
    expect(withCleanupKeepsCard(LOST, { question: "can you clean up my grammar?", history: [] } as unknown as AskRequest)).toBe(LOST);
  });
});
