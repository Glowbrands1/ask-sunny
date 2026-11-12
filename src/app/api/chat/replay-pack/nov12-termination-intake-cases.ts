import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A STATED TERMINATION OPENS ITS FORM (QA, 12 Nov 2026; TERMINATION_INTAKE_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app. (1) "Termination CA for <A>, no call no show." (Gate-Sunny's wording): this app already
 * opens the card (a guard here). (2) The sibling's 17k live test: "Dear <C>, Your employment with <company> is terminated
 * effective 11/10/26." gave no exit card there (live, a refusal); reproduced here: the general answer. The tester's
 * wording, with this app's company and an invented person (Calla Brisbane).
 */
const FLAG = "TERMINATION_INTAKE_ENABLED";
const CALLA: DirectoryRow = { id: "e-ti-calla-brisbane", firstName: "Calla", lastName: "Brisbane", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function terminationIntakePeople(): readonly DirectoryRow[] {
  return [CALLA];
}

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T02:51:34Z"));
  t.directory([...STAFF, CALLA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV12_TERMINATION_INTAKE_CASES: ReplayCase[] = [
  {
    id: "nov12-termination-ca-bare-opens-card",
    title: "\"Termination CA for <A>, no call no show.\": a Corrective Action card for her",
    report: "QA, 12 Nov 2026 (TERMINATION_STATED_TICKS work): the sibling app opened no CA card for Gate-Sunny's wording; a guard here",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("Termination CA for Calla Brisbane, no call no show.");
      expect(thread.proposal, `no CA card for Calla Brisbane:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Calla Brisbane" });
    },
  },
  {
    id: "nov12-17k-termination-letter-exit-card",
    title: "17k: \"Dear <C>, Your employment with Sun Tan City is terminated effective 11/10/26.\": the Resignation/Exit Form card for her, never a refusal",
    report: "QA's Bubbles 17k live test via the sibling app, 12 Nov 2026; reproduced here",
    status: { open: "no exit card: the general answer (live: \"I can't act on this … Want me to start the exit form?\")" },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("Dear Calla Brisbane, Your employment with Sun Tan City is terminated effective 11/10/26.");
      expect(thread.proposal, `no exit card for Calla Brisbane:\n${reply.content}`).toMatchObject({ templateKey: "stc-exit", employeeName: "Calla Brisbane" });
      expect(reply.content, `the reply refuses:\n${reply.content}`).not.toMatch(/can'?t act on this|won'?t draft/i);
    },
  },
  {
    id: "nov12-exit-form-terminated-wording-guard",
    title: "guard: \"exit form for <C>, terminated 11/10/26\" gives the exit card, as the letter now does",
    report: "QA, 12 Nov 2026: the wording the letter should behave like",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("exit form for Calla Brisbane, terminated 11/10/26");
      expect(thread.proposal, `no exit card for Calla Brisbane:\n${reply.content}`).toMatchObject({ templateKey: "stc-exit", employeeName: "Calla Brisbane" });
    },
  },
];
