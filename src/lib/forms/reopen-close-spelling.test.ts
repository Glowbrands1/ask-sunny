import { describe, expect, it } from "vitest";

import { closelySpelledEmployee } from "./reopen-close-spelling";

/*
 * REOPEN_CLOSE_SPELLING_ENABLED. The manager's words are verbatim in shape (Pau via QA, sf-s26, 5 Nov 2026: "Edit
 * <misspelled first and last name> CA"); the person is invented, misspelt the same way in the replay case
 * (`nov5-pau-sf-s26-s28-cases.ts`).
 */
describe("closelySpelledEmployee", () => {
  it("\"Edit Thesaly Brant CA\" is Thessaly Brandt, the one person on file it spells closely", () => {
    expect(closelySpelledEmployee("Edit Thesaly Brant CA", ["Thessaly Brandt", "Odalys Frewen"])).toBe("Thessaly Brandt");
  });

  it("never two people, never a first name alone, never a name already exact", () => {
    expect(closelySpelledEmployee("Edit Thesaly Brant CA", ["Thessaly Brandt", "Thessaly Brand"])).toBeNull();
    expect(closelySpelledEmployee("Edit Thesaly CA", ["Thessaly Brandt"])).toBeNull();
    expect(closelySpelledEmployee("Edit Thessaly Brandt CA", ["Thessaly Brandt"])).toBeNull();
    expect(closelySpelledEmployee("Edit Marisol Brant CA", ["Thessaly Brandt"])).toBeNull();
  });
});
