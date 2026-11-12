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

/** QA's R713 sentence is about "he"; an invented person. */
const DORIAN: DirectoryRow = {
  id: "e-dorian-vallow",
  firstName: "Dorian",
  lastName: "Vallow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** A function, not an array: the registry reads exported arrays as cases. */
export function p17ExitPeople(): readonly DirectoryRow[] {
  return [MARISOL, DORIAN];
}

const LEFT_BLANK = (content: string) => /\*\*Left blank[^:]*:\*\*\s*([^\n]+)/i.exec(content)?.[1] ?? "";

export const NOV10_P17_EXIT_TYPO_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov10-p17-exit-items-and-rehire-misspelled",
    title: "an exit form, \"salon items will be returneded … they are eligiable for rehire\": Store Items Returned and Eligible for Rehire are read, never left blank",
    report: "Pau's P17, Sunny production, 10 Nov 2026",
    // Changed on purpose (12 Nov 2026): fixed in production by EXIT_TYPO_WORDS, QA round 31. Was OPEN.
    status: "fixed",
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
  {
    id: "nov11-r713-not-required-back",
    title: "an exit form, \"he is not required back\": never read as \"not rehired\" (Eligible for Rehire stays blank)",
    report: "QA, R713 (Gate-Bubbles, 11 Nov 2026; the same word list here): \"he is not required back\" gave eligible_for_rehire: no with EXIT_TYPO_WORDS on",
    status: "fixed",
    fixFlags: ["EXIT_TYPO_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
      t.directory([...STAFF, DORIAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need an exit form for Dorian Vallow");
      const reply = await thread.say("he quit on 11/8/26. he is not required back. payroll not deducted");
      expect(thread.proposal, `no exit card for Dorian Vallow:\n${reply.content}`).toMatchObject({ employeeName: "Dorian Vallow" });
      expect(reply.content, `"not required back" was read as "not rehired":\n${reply.content}`).not.toMatch(/not eligible for rehire/i);
      expect(LEFT_BLANK(reply.content), `Eligible for Rehire is filled:\n${reply.content}`).toMatch(/Eligible for Rehire/);
    },
  },
];
