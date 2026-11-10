import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * OCTOBER TRIAGE #9 — THE FORMS EXPLAINED FROM THEIR OWN TEMPLATES (Sunny #262, the sibling app's #194)
 * ============================================================================
 *
 * The owner: "both sunny and bubbles should also guide managers on the differences of each form, like what is a CA,
 * what is coaching and so on. Read the forms and that should be the answer." The triage table: "what is a ca?",
 * "difference between coaching and ca" and "which forms can i create here?" go to the model or the knowledge base
 * (the stand-in's "A grounded answer from the policy manual."), and "what form do i use for someone who quit" gives
 * the whole forms inventory. FORMS_GUIDE_ENABLED (`forms/forms-guide.ts`).
 */

const STAND_IN = /^A grounded answer from the policy manual\./;

const TURNS: { id: string; said: string; says: RegExp; never?: RegExp }[] = [
  { id: "what-is-a-ca", said: "what is a ca?", says: /Corrective Action Form/ },
  { id: "coaching-vs-ca", said: "difference between coaching and ca", says: /Coaching Form[\s\S]*Corrective Action Form|Corrective Action Form[\s\S]*Coaching Form/ },
  { id: "which-forms", said: "which forms can i create here?", says: /Corrective Action Form/ },
  { id: "someone-who-quit", said: "what form do i use for someone who quit", says: /separation|exit|resign/i, never: /Corrective Action Form/ },
];

export const FORMS_GUIDE_FIX = "FORMS_GUIDE_ENABLED";

export const NOV10_FORMS_GUIDE_CASES: ReplayCase[] = TURNS.map(({ id, said, says, never }) => ({
  id: `nov10-forms-guide-${id}`,
  title: `#9: "${said}" → answered from the form templates`,
  report: `October triage #9 (Sunny #262, the sibling app's #194): "${said}" → the model or the knowledge base, not the form templates`,
  status: { open: "the model or the knowledge base answers, not the templates" },
  fixFlags: [FORMS_GUIDE_FIX],
  async run(t) {
    vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(said);
    expect(reply.content, `the model answered:\n${reply.content}`).not.toMatch(STAND_IN);
    expect(reply.content).toMatch(says);
    if (never) expect(reply.content, `the whole inventory:\n${reply.content}`).not.toMatch(never);
    expect(thread.proposal ?? null, "a card nobody asked for").toBeNull();
  },
}));
