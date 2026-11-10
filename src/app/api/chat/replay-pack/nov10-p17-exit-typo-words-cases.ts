import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * Pau's P17 (Sunny production, 10 Nov 2026; coding 6's triage): an exit form whose details said "salon items will be
 * returneded … they are eligiable for rehire" listed Store Items Returned and Eligible for Rehire under "Left blank";
 * payroll "not deducted" was read. The manager's words for those answers verbatim; the person invented.
 */
const MARISOL: DirectoryRow = {
  id: "e-marisol-quenby",
  firstName: "Marisol",
  lastName: "Quenby",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** A function, not an array: the registry reads exported arrays as cases. */
export function p17ExitPeople(): readonly DirectoryRow[] {
  return [MARISOL];
}

const LEFT_BLANK = (content: string) => /\*\*Left blank[^:]*:\*\*\s*([^\n]+)/i.exec(content)?.[1] ?? "";

export const NOV10_P17_EXIT_TYPO_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov10-p17-exit-items-and-rehire-misspelled",
    title: "an exit form, \"salon items will be returneded … they are eligiable for rehire\": Store Items Returned and Eligible for Rehire are read, never left blank",
    report: "Pau's P17, Sunny production, 10 Nov 2026",
    status: { open: "Store Items Returned and Eligible for Rehire are listed under \"Left blank\"" },
    fixFlags: ["EXIT_TYPO_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
      t.directory([...STAFF, MARISOL]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need an exit form for Marisol Quenby");
      const reply = await thread.say(
        "she quit by text on 11/8/26, salon items will be returneded and they are eligiable for rehire. payroll not deducted",
      );
      expect(thread.proposal, `no exit card for Marisol Quenby:\n${reply.content}`).toMatchObject({ employeeName: "Marisol Quenby" });
      expect(LEFT_BLANK(reply.content), `the answers she gave are left blank:\n${reply.content}`).not.toMatch(/items returned|rehire/i);
    },
  },
];
