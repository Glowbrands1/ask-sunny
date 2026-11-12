import { afterEach, describe, expect, it, vi } from "vitest";

import { isOutlineTurn, notesWithoutOutline, withOutlineKeptNote, withoutOutlineTurns } from "./outline-on-proposal";

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
  const ILSA = "Ilsa Varnholt";
  it("reads outline turns", () => {
    expect(isOutlineTurn(OUTLINE, ILSA)).toBe(true);
    expect(isOutlineTurn(C, ILSA)).toBe(true);
    expect(isOutlineTurn(A, ILSA)).toBe(false);
    // A request that mentions a format is the request, never an outline turn (the s22 replay case, 12 Nov 2026).
    expect(isOutlineTurn("create a ca for must see behaviors for wynne sarrow but i need it to be in the format of Tamsyn ca", "Wynne Sarrow")).toBe(false);
  });

  // Gate-Bubbles-4's NO-GO (G4-802) and Gate-Sunny-3's probe of S#875 (12 Nov 2026): the manager's own account is never an outline.
  it.each([
    "Date: 11/3/26\nWhat happened: Ilsa Varnholt arrived 40 minutes late and did not call in.",
    "Ilsa Varnholt was late on 11/3/26. Use this format for the action plan.",
    "Time: 9am\nShift: opening\nshe was late",
    "use this format for her",
    "make it look like this template",
    "Date: 11/3/26\nWhat happened: Ilsa arrived 40 minutes late and did not call in.",
    "same outline but with Ilsa's info, she was late on 11/3/26",
  ])("never an outline turn: %s", (said) => {
    expect(isOutlineTurn(said, ILSA)).toBe(false);
  });

  it("an outline naming another person is one; with no card's employee nothing is", () => {
    expect(isOutlineTurn("Observation of Offense: Tamsyn completed 237 transactions.\nAction Plan: The Leadership Team will coach Tamsyn.", "Wynne Sarrow")).toBe(true);
    expect(isOutlineTurn(OUTLINE, null)).toBe(true);
    expect(isOutlineTurn(C, null)).toBe(false);
  });

  it("off: the request is as sent", () => {
    expect(withoutOutlineTurns({ question: C, history })).toBeNull();
  });

  it("on, no form open: the outline turns are left out and \"same outline …\" is read as step (a)'s request", () => {
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    const read = withoutOutlineTurns({ question: C, history })!;
    // The card's employee is read from the assistant turns ("… for **Ilsa Varnholt** …").
    expect(read.outline).toBe(true);
    expect(read.asked.question).toBe(A);
    expect(read.asked.history.map((turn) => turn.content)).not.toContain(OUTLINE);
  });

  it("on, a form open (an open draft): untouched — the open-draft path places the outline", () => {
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    expect(withoutOutlineTurns({ question: C, history, activeFormInstanceId: "f-1" })).toBeNull();
  });

  it("the outline turn's reply says what is true: her own details are kept (QA, 12 Nov 2026)", () => {
    const out = withOutlineKeptNote({ content: "card", formProposal: { employeeName: "Ilsa Varnholt", templateName: "Corrective Action Form" } });
    expect(out.content).toMatch(/^I've kept \*\*Ilsa Varnholt\*\*'s own details; nothing from the person in the pasted example goes on this card\./);
    expect(out.content).not.toMatch(/as the layout/);
  });

  it("the draft's notes leave the outline turns out; off, as sent", () => {
    const notes = [A, OUTLINE, C].join("\n\n");
    expect(notesWithoutOutline(notes, ILSA)).toBe(notes);
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    expect(notesWithoutOutline(notes, ILSA)).toBe(A);
    // Her own labelled account stays in the notes (G4-802).
    const own = [A, "Date: 11/3/26\nWhat happened: Ilsa Varnholt arrived 40 minutes late and did not call in."].join("\n\n");
    expect(notesWithoutOutline(own, ILSA)).toBe(own);
  });
});
