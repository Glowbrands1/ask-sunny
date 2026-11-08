import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boundManagerTurns, MANAGER_CONTEXT_TURNS } from "./bounded-context";

/*
 * Ported from the sibling app (the coordinator's replays R6/R7, 5 Nov 2026):
 * the manager's turns in order, the person invented with the same typos
 * mapped onto the invented name. The request that carried the account ("…
 * with a customer complaint") was the tenth turn back at "Create a Corrective
 * Action Form from this conversation.", outside the six-turn window, and the
 * card lost the Standards of Conduct it had cited.
 */
const PRIOR = [
  "what are the hours for the kearney salon",
  "i have an employee, Marisol Ortega Valdze that needs a corrective action form with a customer complaint",
  "verbal warning, no payroll deduct, tanning consultant,",
  "fix her last name valdez",
  "make that update",
  "under the employee line the name is supposed to be marisol otrega valdez",
  "redo marisol ortega valdez",
  "make that change to Marisol Prtega Valdez",
  "okay the correct way is Marisol Ortega Valdez",
  "can i review the card",
].map((content, index) => ({ id: `m${index}`, content }));
const CURRENT = { id: "now", content: "Create a Corrective Action Form from this conversation." };
const REQUEST = PRIOR[1]!.content;

beforeEach(() => {
  vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED", "");
  vi.stubEnv("KEPT_REQUEST_SAME_FORM_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "true");

describe("REQUEST_KEPT_IN_WINDOW_ENABLED", () => {
  it("flag off: the request is outside the window (the bug), and the window is as before", () => {
    const window = boundManagerTurns(PRIOR, CURRENT);
    expect(window.messages).toHaveLength(MANAGER_CONTEXT_TURNS);
    expect(window.text).not.toContain(REQUEST);
  });

  it("flag on: this form's requests outside the window lead it, oldest first; the rest of the window is unchanged", () => {
    const before = boundManagerTurns(PRIOR, CURRENT).messages;
    on();
    const window = boundManagerTurns(PRIOR, CURRENT);
    // "verbal warning, no payroll deduct, …" also reads as a request for the Corrective Action Form, so it is kept too.
    expect(window.ids.slice(0, 2)).toEqual(["m1", "m2"]);
    expect(window.messages[0]!.content).toBe(REQUEST);
    expect(window.messages.slice(2)).toEqual(before);
  });

  it("flag on: a request for a different form after it stops the walk (that one's turns only)", () => {
    on();
    const prior = [
      { id: "a", content: REQUEST },
      { id: "b", content: "create a coaching form for Marisol Ortega Valdez for being late" },
      ...PRIOR.slice(3),
    ];
    vi.stubEnv("KEPT_REQUEST_SAME_FORM_ENABLED", "");
    const window = boundManagerTurns(prior, CURRENT);
    expect(window.text).not.toContain(REQUEST);
    expect(window.messages[0]!.content).toBe(prior[1]!.content);
    // Changed on purpose (KEPT_REQUEST_SAME_FORM): this turn asks for the Corrective Action Form and the latest request was
    // for the Coaching Form, a different form, so neither earlier request is kept; the window is the one without
    // REQUEST_KEPT_IN_WINDOW.
    vi.stubEnv("KEPT_REQUEST_SAME_FORM_ENABLED", "true");
    const sameFormOnly = boundManagerTurns(prior, CURRENT);
    expect(sameFormOnly.text).not.toContain(REQUEST);
    expect(sameFormOnly.text).not.toContain(prior[1]!.content);
    vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "");
    expect(sameFormOnly).toEqual(boundManagerTurns(prior, CURRENT));
  });

  it("flag on: a request already in the window adds nothing", () => {
    on();
    const prior = PRIOR.slice(0, 3);
    expect(boundManagerTurns(prior, CURRENT)).toEqual((() => {
      vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "");
      return boundManagerTurns(prior, CURRENT);
    })());
  });

  it("the browser reads NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED", () => {
    vi.stubGlobal("window", {});
    try {
      vi.stubEnv("REQUEST_KEPT_IN_WINDOW_ENABLED", "true");
      expect(boundManagerTurns(PRIOR, CURRENT).text).not.toContain(REQUEST);
      vi.stubEnv("NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED", "true");
      expect(boundManagerTurns(PRIOR, CURRENT).messages[0]!.content).toBe(REQUEST);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
