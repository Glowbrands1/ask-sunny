import { describe, expect, it } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";
import { manualNegatedListNoteEnabled } from "@/lib/config/chat-quality-flags";

import { manualReadingNotes, P19_PHONE_LIST_NOTE, withManualReadingNotes } from "./manual-reading-notes";

/** The stored p.19 chunk, with its line break inside the list ("back\npockets"). */
const CELL_PHONE_CHUNK = manual151.chunks.find((row) => row.chunk_index === 61)!.content;

describe("MANUAL_NEGATED_LIST_NOTE_ENABLED", () => {
  // Registered in flags-off-parity.test.ts (NEW_FLAGS and the default-off assertion).
  it("defaults off", () => {
    const saved = process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED;
    delete process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED;
    expect(manualNegatedListNoteEnabled()).toBe(false);
    process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED = "1";
    expect(manualNegatedListNoteEnabled()).toBe(true);
    if (saved === undefined) delete process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED;
    else process.env.MANUAL_NEGATED_LIST_NOTE_ENABLED = saved;
  });
});

describe("manual reading notes", () => {
  it("notes the p.19 list in the stored chunk, across its line break", () => {
    expect(CELL_PHONE_CHUNK).toContain("back\npockets, charging in the break room");
    const notes = manualReadingNotes([CELL_PHONE_CHUNK]);
    expect(notes).toContain(P19_PHONE_LIST_NOTE);
    expect(P19_PHONE_LIST_NOTE).toContain("charging in the break room is not allowed");
    expect(P19_PHONE_LIST_NOTE).toContain("three places the phone may NOT be");
  });

  it("reads the cached manual as well as the grounding block", () => {
    const grounding = "COMPANY KNOWLEDGE\n\nThe full current policy manual is in the system prefix.";
    const out = withManualReadingNotes(grounding, `FULL POLICY MANUAL\n\n[p.19]\n${CELL_PHONE_CHUNK}`);
    expect(out.startsWith(`${grounding}\n\nMANUAL READING NOTES`)).toBe(true);
    expect(out).toContain(P19_PHONE_LIST_NOTE);
  });

  it("leaves grounding without the sentence byte-for-byte as it was", () => {
    const grounding = "COMPANY KNOWLEDGE\n\n[S1] Company Email Account\nCompany email is for authorized Employees only.";
    expect(withManualReadingNotes(grounding, null)).toBe(grounding);
    expect(withManualReadingNotes(grounding, "FULL POLICY MANUAL\n\n[p.15]\nDress Code")).toBe(grounding);
    expect(manualReadingNotes([grounding, null, undefined])).toBeNull();
  });

  it("does not fire on the manager's paste or on answers that only mention the break room", () => {
    expect(
      manualReadingNotes([
        '"Personal cell phones are permitted in the workplace but must be kept out of sight." what does this mean?',
        "Phones may not be charging in the break room [p.19].",
      ]),
    ).toBeNull();
  });
});
