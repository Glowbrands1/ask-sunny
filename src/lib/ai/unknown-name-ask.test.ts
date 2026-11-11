import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskRequest, AskResponse } from "./types";
import { typedName, withUnknownNameAsk } from "./unknown-name-ask";

/** QA's round-6 audit (8 Nov 2026), the sibling app's BF7 chain in this app's words; the name is invented. */
const ASK =
  "Who is this **Corrective Action Form** for? Give me their name and I'll draft it from what you've told me — you can set the warning level and anything else on the form itself.";
const TURNS = ["i need to issue a ca for someone being late", "quinn marlowe was late on 10/20 and the salon was opened late"];

function request(question: string, history: { role: string; content: string }[]): AskRequest {
  return { question, history } as unknown as AskRequest;
}
const card = (content: string, employeeName: string | null = null) => ({ content, formProposal: { employeeName } }) as unknown as AskResponse;

afterEach(() => vi.unstubAllEnvs());

describe("UNKNOWN_NAME_ASK", () => {
  it("off: the reply is unchanged (the report)", () => {
    const answer = card(`${ASK}\n\n**Date:** 10/20/2026`);
    expect(withUnknownNameAsk(answer, request(TURNS[1]!, [{ role: "user", content: TURNS[0]! }, { role: "assistant", content: ASK }]))).toBe(answer);
  });

  it("on: the typed name is named back, once, and every reply still asks who the form is for", () => {
    vi.stubEnv("UNKNOWN_NAME_ASK_ENABLED", "true");
    const first = withUnknownNameAsk(card(`${ASK}\n\n**Date:** 10/20/2026`), request(TURNS[1]!, [{ role: "user", content: TURNS[0]! }, { role: "assistant", content: ASK }]));
    expect(first.content).toMatch(/^I couldn't match \*\*quinn marlowe\*\* to anyone on the directory\. Who is this \*\*Corrective Action Form\*\* for\?/);
    expect(first.content).toContain("**Date:** 10/20/2026");
    const second = withUnknownNameAsk(
      card(ASK),
      request("yes payroll deduct", [{ role: "user", content: TURNS[0]! }, { role: "assistant", content: ASK }, { role: "user", content: TURNS[1]! }, { role: "assistant", content: first.content }]),
    );
    expect(second.content).not.toMatch(/couldn't match/);
    expect(second.content).toMatch(/\*\*quinn marlowe\*\* isn't on the directory\. Who is this \*\*Corrective Action Form\*\* for\?/);
  });

  it("on: a card that has its employee, or a reply without the name question, is unchanged", () => {
    vi.stubEnv("UNKNOWN_NAME_ASK_ENABLED", "true");
    const withEmployee = card(ASK, "Marnie Holloway");
    expect(withUnknownNameAsk(withEmployee, request(TURNS[1]!, []))).toBe(withEmployee);
    const other = card("I'll draft a **Corrective Action Form** for **Marnie Holloway** …");
    expect(withUnknownNameAsk(other, request(TURNS[1]!, []))).toBe(other);
  });

  it("on, no name typed: the first ask stays; a repeat is in new words", () => {
    vi.stubEnv("UNKNOWN_NAME_ASK_ENABLED", "true");
    const first = card(ASK);
    expect(withUnknownNameAsk(first, request(TURNS[0]!, []))).toBe(first);
    const again = withUnknownNameAsk(card(ASK), request("yes payroll deduct", [{ role: "user", content: TURNS[0]! }, { role: "assistant", content: ASK }]));
    expect(again.content).toMatch(/^Who is this \*\*Corrective Action Form\*\* for\? I need the employee's full name/);
  });

  it.each(["the salon was opened late", "she was late on 10/20", "my employee was late"])("typedName: %s names nobody", (text) => {
    expect(typedName([text])).toBeNull();
  });
});
