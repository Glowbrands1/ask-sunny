import { afterEach, describe, expect, it } from "vitest";

import { CHAT_GLOSSARY, GLOSSARY_TERMS, foldsToGlossaryTerm, isGlossaryTerm, mentionsGlossaryTerm } from "./chat-glossary";

/**
 * CHAT_GLOSSARY_ENABLED. The approved text (Pau, 4 Nov 2026), byte for byte.
 * Ported from Ask Bubbles (40146f84, #419): there the module is `ai/glossary.ts`;
 * here `ai/glossary.ts` is the protected house-terms table, so `ai/chat-glossary.ts`.
 * The expected string is written out here, not imported, and the sibling
 * app's test pins the SAME string: the two apps must never drift apart.
 */
const APPROVED =
  'ABBREVIATIONS MANAGERS USE\n' +
  'MSB = Must See Behaviors. In "corrective action for MSB" it is the reason for the form, not a person.\n' +
  "A word in this table is never an employee's name and is never saved as one. If you cannot tell whether a word is a person or one of these terms, ask the manager once which employee they mean.";

const saved = process.env.CHAT_GLOSSARY_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.CHAT_GLOSSARY_ENABLED;
  else process.env.CHAT_GLOSSARY_ENABLED = saved;
});

describe("the abbreviation glossary", () => {
  it("is the approved text, byte for byte: three lines, no trailing newline", () => {
    expect(CHAT_GLOSSARY).toBe(APPROVED);
    expect(CHAT_GLOSSARY.split("\n")).toHaveLength(3);
    expect(Buffer.from(CHAT_GLOSSARY, "utf8").equals(Buffer.from(APPROVED, "utf8"))).toBe(true);
  });

  it("reads its terms from the table's \"X = …\" lines: MSB only", () => {
    expect([...GLOSSARY_TERMS]).toEqual(["msb"]);
  });

  it("folds case and dots: msb, Msb, MSB and M.S.B. are the term; a person is not", () => {
    for (const word of ["msb", "Msb", "MSB", "M.S.B.", " msb "]) expect(foldsToGlossaryTerm(word), word).toBe(true);
    for (const word of ["Thea Quillfeather", "msbs", "Must See Behaviors", "", null]) expect(foldsToGlossaryTerm(word), String(word)).toBe(false);
  });

  it("the guard is off with the flag off", () => {
    delete process.env.CHAT_GLOSSARY_ENABLED;
    expect(isGlossaryTerm("msb")).toBe(false);
    expect(mentionsGlossaryTerm("I need to make a corrective action for msb")).toBe(false);
    process.env.CHAT_GLOSSARY_ENABLED = "true";
    expect(isGlossaryTerm("Msb")).toBe(true);
    expect(mentionsGlossaryTerm("I need to make a corrective action for msb")).toBe(true);
    expect(mentionsGlossaryTerm("Create a Corrective Action for Thea Quillfeather")).toBe(false);
  });
});
