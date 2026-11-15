import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TERMINATION_TICK_NOTE, withTerminationTickNote } from "./termination-tick-note";
import type { AskRequest, AskResponse } from "./types";

const ASKED = "You'll set the verbal/written warning level on the form — I won't guess at it.";
const card = (content: string, warningLevel: string | null = null) =>
  ({ content, formProposal: { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Marnie Holloway", warningLevel } }) as unknown as AskResponse;
const asked = (question: string) => ({ question, history: [] }) as unknown as AskRequest;

/** QA, 15 Nov 2026: a termination mentioned in chat and not ticked left only the verbal/written line. Invented names. */
describe("TERMINATION_TICK_NOTE_ENABLED on", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINATION_TICK_NOTE_ENABLED", "true");
    // Production has the stated-termination reader on; it ticks "term CA", so the note leaves that alone.
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["my DM approved her termination, write up the CA for Marnie Holloway"],
    ["Marnie Holloway is terminated, make the CA"],
    ["write a CA, termination, for Marnie Holloway"],
  ])("%s → the note is added beside the verbal/written line", (said) => {
    // Changed on purpose (QA's re-review of #1010): the level line is never removed; the neutral note goes after it.
    expect(withTerminationTickNote(card(`I'll draft a CA.\n\n${ASKED}`), asked(said)).content).toBe(`I'll draft a CA.\n\n${ASKED}\n\n${TERMINATION_TICK_NOTE}`);
  });

  /*
   * QA's re-review (15 Nov 2026): conditional and future mentions still read as a mention; a false note is cheap when it
   * is neutral, a missing level prompt is harmful. So the verbal/written line stays and the note is added beside it.
   */
  it.each([
    ["if she does it again she will be terminated, write up Marnie Holloway for being late"],
    ["write up Marnie Holloway for being late, next time it's termination"],
    ["final warning before termination for Marnie Holloway, she was late again"],
    ["we might terminate her later, for now write up Marnie Holloway for being late"],
    ["I'd hold off on termination, write up Marnie Holloway for being late"],
  ])("%s → the level line stays, with the note after it", (said) => {
    const out = withTerminationTickNote(card(`I'll draft a CA.\n\n${ASKED}`), asked(said)).content;
    expect(out).toContain(ASKED);
    expect(out).toBe(`I'll draft a CA.\n\n${ASKED}\n\n${TERMINATION_TICK_NOTE}`);
  });

  it("the note's wording is neutral: if this form is a termination", () => {
    expect(TERMINATION_TICK_NOTE).toBe("If this form is a termination, tick Termination on the form yourself; it needs DM/HR approval before it's finalized.");
  });

  it("with no level line, the note is added after the opening line", () => {
    expect(withTerminationTickNote(card("I'll draft a CA.\n\nMore."), asked("Marnie Holloway is terminated, make the CA")).content).toBe(`I'll draft a CA.\n\n${TERMINATION_TICK_NOTE}\n\nMore.`);
  });

  it("a stated termination (ticked by TERMINATION_STATED_TICKS), a level on the card, or no termination: unchanged", () => {
    const before = card(`I'll draft a CA.\n\n${ASKED}`);
    expect(withTerminationTickNote(before, asked("I need a term CA for Marnie Holloway."))).toBe(before);
    // A level on the card already: unchanged.
    expect(withTerminationTickNote(card(ASKED, "written"), asked("Marnie Holloway is terminated, make the CA"))).toEqual(card(ASKED, "written"));
    expect(withTerminationTickNote(before, asked("she was late, long term issue"))).toBe(before);
  });
});

describe("QA's review of #1010: a negation, a question or another person's termination is no termination here", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINATION_TICK_NOTE_ENABLED", "true");
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  const before = card(`I'll draft a CA.\n\n${ASKED}`);
  const history = (turns: string[], question: string) =>
    ({ question, history: turns.map((content) => ({ role: "user", content })) }) as unknown as AskRequest;

  it.each([
    ["I don't want to terminate her, just document the lateness for Marnie Holloway"],
    ["she is not being terminated, write up Marnie Holloway for the lateness"],
    ["Marnie Holloway was late again. We won't terminate her, write the CA"],
    ["what is the termination policy for being late? write up Marnie Holloway"],
  ])("%s → no note", (said) => {
    expect(withTerminationTickNote(before, asked(said))).toBe(before);
  });

  it("another person's termination earlier in the chat never reaches this card", () => {
    const said = history(["Remy Calder is terminated, make the CA", "thanks"], "now write up Marnie Holloway, she was late on 11/12");
    expect(withTerminationTickNote(before, said)).toBe(before);
  });

  it("a termination policy question earlier in the chat never reaches this card", () => {
    const said = history(["what's the termination policy for no call no shows?"], "write up Marnie Holloway, she was late on 11/12");
    expect(withTerminationTickNote(before, said)).toBe(before);
  });

  it("this person's own request, across turns, still gets it", () => {
    const said = history(["my DM approved the termination, make the CA"], "Marnie Holloway");
    expect(withTerminationTickNote(before, said).content).toContain(TERMINATION_TICK_NOTE);
  });
});

describe("TERMINATION_TICK_NOTE_ENABLED off: as built", () => {
  it("nothing changes", () => {
    const before = card(`I'll draft a CA.\n\n${ASKED}`);
    expect(withTerminationTickNote(before, asked("Marnie Holloway is terminated, make the CA"))).toBe(before);
  });
});
