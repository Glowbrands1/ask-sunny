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
    // Gate-Sunny-3's NO-GO on S#875 (12 Nov 2026): her account names a coworker, a witness or a nickname.
    "Date: 11/3/26\nWhat happened: Ilsa was 40 minutes late to her opening shift. Jordan had to cover the front desk until she arrived",
    "Date: 11/3/26\nWhat happened: Marco called to say Ilsa would be late.\nWitness: Marco",
    "Observation of Offense: Ilsa was 40 minutes late. Jordan had to cover the front desk.\nAction Plan: coach Ilsa on arriving on time.",
    "Observation of Offense: Ilsa Varnholt was late on 11/3/26.\nAction Plan: Management will coach her.",
  ])("never an outline turn: %s", (said) => {
    expect(isOutlineTurn(said, ILSA)).toBe(false);
  });

  it("a nickname the manager typed in the request is hers (Gate-Sunny-3)", () => {
    const liz = "Observation of Offense: Liz was 40 minutes late.\nAction Plan: The Leadership Team will coach Liz.";
    expect(isOutlineTurn(liz, ["Elizabeth Varnholt", "liz varnholt"])).toBe(false);
    vi.stubEnv("OUTLINE_ON_OPEN_PROPOSAL_ENABLED", "true");
    expect(notesWithoutOutline(["create a corrective action for liz varnholt", liz].join("\n\n"), "Elizabeth Varnholt")).toContain("Liz was 40 minutes late");
  });

  // QA (12 Nov 2026): a lower-case outline is not caught — acceptable; any doubt keeps the turn as her account.
  it("a lower-case outline is kept as her account (no named subject can be read)", () => {
    expect(isOutlineTurn("observation of offense: corisande velt arrived 20 minutes late.\naction plan: the leadership team will coach corisande.", ILSA)).toBe(false);
  });

  // Gate-Sunny-3's NO-GO on S#875, round 3 (12 Nov 2026), and QA's probes: her own account in the form's labels.
  it.each([
    ["Ilsa Varnholt", "Observation of Offense: she arrived 40 minutes late to her opening shift on 11/3/26. Jordan had to open the salon.\nAction Plan: Leadership will review the attendance policy with her"],
    ["Elizabeth Varnholt", "Observation of Offense: Liz arrived 40 minutes late to her opening shift on 11/3/26.\nAction Plan: Leadership will review the attendance policy with her"],
    ["Ilsa Varnholt", "Date: 11/3/26\nWhat happened: Ilsa was 40 minutes late. Marco called me at 9:10 to say the salon was not open."],
    ["Ilsa Varnholt", "Date: 11/3/26\nWhat happened: she was 40 minutes late and Jordan had to cover her shift"],
    ["Elizabeth Varnholt", "Date: 11/3/26\nWhat happened: Liz was 40 minutes late"],
    ["Ilsa Varnholt", "Observation of Offense: Marco Ruiz reported that she arrived 40 minutes late on 11/3/26.\nAction Plan: coach her on arriving on time."],
    ["Ilsa Varnholt", "Observation of Offense: Jordan Pike opened the salon because she arrived 40 minutes late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: On 11/3/26, she arrived 40 minutes late. Corisande Velt opened the salon.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: The employee arrived 40 minutes late on 11/3/26.\nAction Plan: The Leadership Team will coach the employee."],
    ["Ilsa Varnholt", "Observation of Offense: Leadership Team noticed she arrived late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: Tamsyn completed 237 transactions.\nAction Plan: The Leadership Team will coach Tamsyn."],
    ["Ilsa Varnholt", "Observation of Offense: I. Varnholt arrived 40 minutes late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: Ilsa V arrived 40 minutes late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: Jordan Pike had to open the salon because she was 40 minutes late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: Jordan Pike covered for 40 minutes; she never called in.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: Salon Director Jane Doe saw her arrive 40 minutes late.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Observation of Offense: arrived 40 minutes late on 11/3/26, Jordan Pike opened.\nAction Plan: coach her."],
    ["Ilsa Varnholt", "Expectation: be on time\nGoing Forward: she will call if late"],
  ])("her own account (card %s), never an outline: %s", (card, said) => {
    expect(isOutlineTurn(said, card)).toBe(false);
  });

  it.each([
    "Observation of Offense: Corisande Velt arrived 20 minutes late on 10/12/26.\nAction Plan: The Leadership Team will coach Corisande.",
    "Observation of Offense: On 10/12/26, Corisande Velt arrived 20 minutes late.\nAction Plan: coach Corisande.",
    "Observation of Offense: During the month of September 2026, Tamsyn Reeve completed 237 transactions.\n\nAction Plan: The Leadership Team will coach Tamsyn.",
  ])("another named person's outline: %s", (said) => {
    expect(isOutlineTurn(said, "Ilsa Varnholt")).toBe(true);
  });
  it("an outline naming another person is one; with no card's employee nothing is", () => {
    // Changed on purpose (Gate-Sunny-3 round 3, 12 Nov 2026): a single first name may be her nickname, so it is kept as
    // her account; a first and last name that is not hers is another person's outline.
    expect(isOutlineTurn("Observation of Offense: Tamsyn completed 237 transactions.\nAction Plan: The Leadership Team will coach Tamsyn.", "Wynne Sarrow")).toBe(false);
    expect(isOutlineTurn("Observation of Offense: Tamsyn Reeve completed 237 transactions.\nAction Plan: The Leadership Team will coach Tamsyn.", "Wynne Sarrow")).toBe(true);
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
