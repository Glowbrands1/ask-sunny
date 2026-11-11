import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "SHE IS AN HR ASSISTANT": THE CARD'S JOB TITLE IS "HR ASSISTANT", NEVER "HR ASSISTANT" WITH A LOWER-CASE R (QA, #207;
 * TITLE_INITIALISM_CASE_ENABLED)
 * ============================================================================
 *
 * The manager's wording (#207, B16), the employee invented and on the directory with no position, so the title she
 * typed fills the card (JOB_TITLE_FROM_WORDS, on in production). With production's flags the title reads "Hr Assistant",
 * however "HR" was typed.
 */
const WREN: DirectoryRow = {
  id: "e-wren-halloway",
  firstName: "Wren",
  lastName: "Halloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: null,
};

const cases = ([
  ["as-typed", "create a coaching form for Wren Halloway at Kearney, she is an HR assistant, for being late on 10-20-26"],
  ["lowercase", "create a coaching form for wren halloway at kearney, she is an hr assistant, for being late on 10-20-26"],
] as const).map(([key, said]): ReplayCase => ({
  id: `nov11-title-initialism-hr-assistant-${key}`,
  title: `"${said}": the card's Job Title is "HR Assistant"`,
  report: "QA (#207): \"she is an HR assistant\" put \"Hr Assistant\" on the card",
  status: { open: "the card's Job Title is \"Hr Assistant\"" },
  fixFlags: ["TITLE_INITIALISM_CASE_ENABLED"],
  async run(t) {
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    t.directory([...STAFF, WREN]);
    t.as("salon_director", KEARNEY);
    const reply = await t.thread().say(said);
    expect(reply.formProposal, `no card:\n${reply.content}`).toMatchObject({ employeeName: "Wren Halloway" });
    expect(reply.formProposal?.employeeRole, `the card's title:\n${reply.content}`).toBe("HR Assistant");
    expect(reply.content, `"Hr" in the reply:\n${reply.content}`).not.toMatch(/\bHr Assistant\b/);
  },
}));

export const NOV11_TITLE_INITIALISM_CASE_CASES: readonly ReplayCase[] = cases;
