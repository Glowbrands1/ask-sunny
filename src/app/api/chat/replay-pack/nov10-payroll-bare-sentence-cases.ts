import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "PAYROLL DEDUCTION." IS THE ANSWER, YES (Pau's P15, Sunny production, 9 Nov 2026)
 * ============================================================================
 *
 * The manager's words, verbatim except the person (invented: Delphine Marrow). The card still asked "Is payroll
 * deduct applicable?" and the created form's Payroll Deduct box was blank (the manager ticked Yes by hand).
 * PAYROLL_BARE_SENTENCE_ENABLED. ("term" — the Termination level — waits on Pau's ruling: chat never ticks
 * Termination, `escalation-guard.ts`.)
 */

const DELPHINE: DirectoryRow = {
  id: "e-pb-delphine-marrow",
  firstName: "Delphine",
  lastName: "Marrow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function payrollBareSentencePeople(): readonly DirectoryRow[] {
  return [DELPHINE];
}

const P15 = "I need a term CA for Delphine Marrow. Didn't show up for her opening shift. Payroll deduction.";

export const NOV10_PAYROLL_BARE_SENTENCE_CASES: ReplayCase[] = [
  {
    id: "nov10-p15-payroll-deduction-sentence-is-yes",
    title: "P15: \"… Payroll deduction.\": the card never asks the payroll question, and Create ticks Payroll Deduct Yes",
    report: 'Pau via QA, 10 Nov 2026 (P15, conv 9 Nov ~16:35Z): "I need a term CA for <name>. Didn\'t show up for her opening shift. Payroll deduction." → "Is payroll deduct applicable?"',
    status: { open: "the card asks \"Is payroll deduct applicable?\" and the created form's Payroll Deduct box is blank" },
    fixFlags: ["PAYROLL_BARE_SENTENCE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:35:00Z"));
      t.directory([...STAFF, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(P15);
      expect(thread.proposal, `no CA card for Delphine Marrow:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Delphine Marrow" });
      expect(reply.content, "the card asks the payroll question the manager answered").not.toMatch(/Is payroll deduct applicable\?\*\* Yes or No\?/i);
      const id = await thread.create();
      expect(t.checked(id).payroll_deduct ?? [], "Payroll Deduct is not Yes").toEqual(["yes"]);
    },
  },
];
