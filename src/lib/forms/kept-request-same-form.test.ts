import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boundManagerTurns, MANAGER_CONTEXT_TURNS } from "./bounded-context";

/*
 * KEPT_REQUEST_SAME_FORM_ENABLED (QA's round-6 item, 8 Nov 2026). The production conversation of 20 Oct 2026 (the
 * person invented): a Corrective Action for <A> for Late Opening, policy questions, then "Create a Coaching Form from
 * this conversation." With REQUEST_KEPT_IN_WINDOW on, the Corrective Action request was kept in the Coaching card's
 * window, so the card read <A> from it and lost "I took <A> from earlier in this conversation".
 */
const PRIOR = [
  "create corrective action for Wren Halvorsen for Late Opening from the policy manual. It is a verbal warning",
  "can you add late opening policy to the direct policy section of this form",
  "I have independently verified and the policy is correct",
  "what does the manual say about reimbursing the company?",
  "how much is the late opening fee?",
  "and who pays for client restitution?",
  "ok thanks",
].map((content, index) => ({ id: `m${index}`, content }));
const REQUEST = PRIOR[0]!.content;
const at = (content: string) => ({ id: "now", content });

beforeEach(() => {
  vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "true");
  vi.stubEnv("KEPT_REQUEST_SAME_FORM_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("KEPT_REQUEST_SAME_FORM_ENABLED", "true");

describe("KEPT_REQUEST_SAME_FORM_ENABLED", () => {
  it("off: a Coaching Form asked for keeps the Corrective Action request (the bug)", () => {
    expect(boundManagerTurns(PRIOR, at("Create a Coaching Form from this conversation.")).text).toContain(REQUEST);
  });

  it("on: a Coaching Form asked for keeps no Corrective Action request; the window is as without REQUEST_KEPT_IN_WINDOW", () => {
    on();
    const window = boundManagerTurns(PRIOR, at("Create a Coaching Form from this conversation."));
    expect(window.text).not.toContain(REQUEST);
    expect(window.messages).toHaveLength(MANAGER_CONTEXT_TURNS);
  });

  it("on: the same form asked for again still keeps its request", () => {
    on();
    expect(boundManagerTurns(PRIOR, at("Create a Corrective Action Form from this conversation.")).text).toContain(REQUEST);
  });

  it("on: a turn that asks for no form still keeps the request", () => {
    on();
    expect(boundManagerTurns(PRIOR, at("make it a written warning")).text).toContain(REQUEST);
  });

  it("on, without REQUEST_KEPT_IN_WINDOW: nothing is kept either way", () => {
    on();
    vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "");
    expect(boundManagerTurns(PRIOR, at("Create a Corrective Action Form from this conversation.")).text).not.toContain(REQUEST);
  });
});
