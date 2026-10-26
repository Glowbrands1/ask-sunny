import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { describedAttendanceKeys } from "./ca-policy";
import { describesAttendanceToo } from "./late-open";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * A LATENESS THE MANAGER DENIES IS NOT ONE (NEGATED_LATE_SHIFT_ENABLED)
 * ============================================================================
 *
 * QA-2, 26 Oct 2026 (coordinator decision): "was not late to her shift" and
 * "was never late" cited Attendance p.14. Each wording in lowercase, sentence
 * case and CAPS; names invented. Flag off is main's reading.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.stubEnv("NEGATED_LATE_SHIFT_ENABLED", ""));

const on = () => vi.stubEnv("NEGATED_LATE_SHIFT_ENABLED", "true");
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [lower(text), sentence(text), text.toUpperCase()];
const sections = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);

const DENIED = [
  "Devon Harlan was not late to her shift on 10-12-26.",
  "Devon Harlan was never late, she was rude to a client.",
  "Devon Harlan wasn't late to her shift.",
  "Devon Harlan wasnt late on 10-12-26.",
  "Devon Harlan is not late, she just forgot to clock in.",
].flatMap(registers);

const STILL = [
  { text: "Devon Harlan wasn't late but left early on 10-12-26.", keys: ["tardiness"] },
  { text: "Devon Harlan was late, not absent, on 10-12-26.", keys: ["tardiness"] },
  { text: "Devon Harlan was late to her shift on 10-12-26.", keys: ["tardiness"] },
  { text: "Devon Harlan was not on time and was late again.", keys: ["tardiness"] },
  { text: "Devon Harlan was absent on 10-12-26.", keys: ["absenteeism"] },
].flatMap(({ text, keys }) => registers(text).map((typed) => ({ text: typed, keys })));

describe("flag on: a denied lateness reads no attendance", () => {
  it.each(DENIED)("%s", (text) => {
    on();
    expect(describedAttendanceKeys(text)).toBeNull();
    expect(describesAttendanceToo(text)).toBe(false);
    expect(sections(text)).not.toContain("Attendance p.14");
  });
});

describe("flag on: what is still said is still read", () => {
  it.each(STILL)("$text", ({ text, keys }) => {
    on();
    expect(describedAttendanceKeys(text)).toEqual(keys);
    expect(sections(text)).toContain("Attendance p.14");
  });
});

describe("flag off: main's reading, unchanged", () => {
  it.each(DENIED)("still reads lateness (the bug): %s", (text) => {
    expect(describedAttendanceKeys(text)).toEqual(["tardiness"]);
    expect(sections(text)).toContain("Attendance p.14");
  });

  it("still reads both for 'late, not absent'", () => {
    expect(describedAttendanceKeys("Devon Harlan was late, not absent, on 10-12-26.")).toEqual(["tardiness", "absenteeism"]);
  });
});
