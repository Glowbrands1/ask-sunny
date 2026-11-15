import { afterEach, describe, expect, it, vi } from "vitest";

import { PAYROLL_AMOUNT_QUESTION } from "@/lib/forms/payroll-amount-field";

import { AMOUNT_UNKNOWN_ACK, saysAmountUnknown, withAmountUnknownAck } from "./amount-unknown-ack";
import type { AskRequest, AskResponse } from "./types";

const ASKED = [{ role: "assistant", content: `Here's the card.\n\n${PAYROLL_AMOUNT_QUESTION}` }];

/* QA, batch J (15 Nov 2026): the shared reader reads the not-known amount after the payroll answer in one message. */
describe("the amount the manager says is not known", () => {
  /* Changed on purpose (QA's #1028 review): a bare not-known line is the amount only as a reply to the amount question. */
  it("reads a message that is only that, in reply to the amount question", () => {
    expect(saysAmountUnknown("i dont know the amount", ASKED)).toBe(true);
    expect(saysAmountUnknown("not sure of the amount", ASKED)).toBe(true);
    expect(saysAmountUnknown("i dont know the amount", [])).toBe(false);
  });
  it("reads it after the payroll answer: \"but\", a comma or a semicolon", () => {
    expect(saysAmountUnknown("yes payroll but I don't know the amount", [])).toBe(true);
    expect(saysAmountUnknown("yes payroll, idk the amount", [])).toBe(true);
    expect(saysAmountUnknown("payroll deduct yes; not sure about the amount", [])).toBe(true);
  });
  it("a clause that is not about the amount is not", () => {
    expect(saysAmountUnknown("yes payroll but only for the shift", [])).toBe(false);
    expect(saysAmountUnknown("yes payroll, $15", [])).toBe(false);
    expect(saysAmountUnknown("she said she doesn't know but the amount is $15", [])).toBe(false);
  });

  /* QA's #1028 review (MEDIUM), QA's wording: an unknown amount of something else is never the payroll amount. */
  it.each([
    "she was late, but I don't know the amount of time",
    "she was short on the drawer, not sure of the amount",
    "verbal for Remy, she was $40 short, idk the total",
  ])("%s → not the payroll amount, even after the amount question", (said) => {
    expect(saysAmountUnknown(said, [])).toBe(false);
    expect(saysAmountUnknown(said, ASKED)).toBe(false);
  });
});

describe("withAmountUnknownAck (AMOUNT_UNKNOWN_ACK_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const card = (question: string): [AskResponse, AskRequest] => [
    { content: `Here's the Corrective Action Form for **Juno Paxton**.\n\n${PAYROLL_AMOUNT_QUESTION}`, formProposal: {} } as unknown as AskResponse,
    { question, history: [] } as unknown as AskRequest,
  ];

  it.each([
    "she was late, but I don't know the amount of time",
    "she was short on the drawer, not sure of the amount",
    "verbal for Remy, she was $40 short, idk the total",
  ])("%s → the amount question stays", (said) => {
    vi.stubEnv("AMOUNT_UNKNOWN_ACK_ENABLED", "true");
    const [response, request] = card(said);
    expect(withAmountUnknownAck(response, request).content).toBe(response.content);
  });

  it("yes payroll but I don't know the amount → the acknowledgement takes the question's place", () => {
    vi.stubEnv("AMOUNT_UNKNOWN_ACK_ENABLED", "true");
    const [response, request] = card("yes payroll but I don't know the amount");
    const content = withAmountUnknownAck(response, request).content;
    expect(content).toContain(AMOUNT_UNKNOWN_ACK);
    expect(content).not.toContain(PAYROLL_AMOUNT_QUESTION);
  });
});

describe("the agent loop: payroll Yes with the amount open", () => {
  it("a bare not-known line is the amount when the caller says the amount is the open question", () => {
    expect(saysAmountUnknown("i dont know the amount", [], { amountOpen: true })).toBe(true);
    expect(saysAmountUnknown("she was short on the drawer, not sure of the amount", [], { amountOpen: true })).toBe(false);
  });
});
