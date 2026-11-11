import { afterEach, describe, expect, it, vi } from "vitest";

import { isOutlineTurn, withOutlineKeptNote, withoutOutlineTurns } from "./outline-on-proposal";

/* OUTLINE_ON_OPEN_PROPOSAL_ENABLED (ported from the sibling app: QA's Bubbles 17i live test, 11 Nov 2026). The tester's turns; invented people. */
const A = "create a corrective action for Ilsa Varnholt, she was late on 11/3/26";
const OUTLINE = "Observation of Offense: Corisande Velt arrived 20 minutes late on 10/12/26.\nAction Plan: The Leadership Team will coach Corisande.";
const C = "same outline but with Ilsa's info";
const history = [
  { role: "user", content: A },
  { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Ilsa Varnholt** …" },
  { role: "user", content: OUTLINE },
  { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Ilsa Varnholt** …" },
];

afterEach(() => vi.unstubAllEnvs());

describe("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", () => {
  it("reads outline turns", () => {
    expect(isOutlineTurn(OUTLINE)).toBe(true);
    expect(isOutlineTurn(C)).toBe(true);
    expect(isOutlineTurn(A)).toBe(false);
  });

  it("off: the request is as sent", () => {
    expect(withoutOutlineTurns({ question: C, history })).toBeNull();
  });

  it("on, no form open: the outline turns are left out and \"same outline …\" is read as step (a)'s request", () => {
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    const read = withoutOutlineTurns({ question: C, history })!;
    expect(read.outline).toBe(true);
    expect(read.asked.question).toBe(A);
    expect(read.asked.history.map((turn) => turn.content)).not.toContain(OUTLINE);
  });

  it("on, a form open (an open draft): untouched — the open-draft path places the outline", () => {
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    expect(withoutOutlineTurns({ question: C, history, activeFormInstanceId: "f-1" })).toBeNull();
  });

  it("the outline turn's reply says the outline is kept for her form", () => {
    const out = withOutlineKeptNote({ content: "card", formProposal: { employeeName: "Ilsa Varnholt", templateName: "Corrective Action Form" } });
    expect(out.content).toMatch(/^I've kept your outline as the layout for \*\*Ilsa Varnholt\*\*'s Corrective Action Form, with Ilsa's own details/);
  });
});
