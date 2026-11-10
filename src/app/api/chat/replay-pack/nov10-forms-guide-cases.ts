import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE FORMS EXPLAINED FROM THEIR OWN TEMPLATES (October rebuild 8, #262, 10 Nov 2026)
 * ============================================================================
 *
 * The owner (26 Oct 2026): "both sunny and bubbles should also guide managers on the differences of each form, like
 * what is a CA, what is coaching and so on. Read the forms and that should be the answer." Tester replay S27: "can you
 * make a generic policy review form that works for any employee". QA's October triage (docs/parity-log/oct-pr-triage.md,
 * 10 Nov 2026), with production's flags: the first three go to the model or knowledge base (the pack's stand-in "A
 * grounded answer from the policy manual."), and "what form do i use for someone who quit" gives the whole inventory.
 * The answers come from the published templates (FORMS_GUIDE_ENABLED, default off).
 */
const FLAG = "FORMS_GUIDE_ENABLED";
const REPORT = "Owner, 26 Oct 2026; tester replay S27 (#262; the October triage, 10 Nov 2026)";
const STAND_IN = "A grounded answer from the policy manual.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const ASKS: readonly { key: string; text: string; check: (content: string) => void }[] = [
  {
    key: "what-is-a-ca",
    text: "what is a ca?",
    check: (content) => expect(content).toContain("**Corrective Action Form** — "),
  },
  {
    key: "coaching-vs-ca",
    text: "difference between coaching and ca",
    check: (content) => {
      expect(content).toContain("**Coaching Form** — ");
      expect(content).toContain("**Corrective Action Form** — ");
    },
  },
  {
    key: "which-forms",
    text: "which forms can i create here?",
    check: (content) => expect(content).toMatch(/you can create these \d+ forms/),
  },
  {
    key: "someone-who-quit",
    text: "what form do i use for someone who quit",
    check: (content) => {
      // The situation's own form, never the whole inventory ("These are the forms published in …").
      expect(content).toMatch(/The forms? for this (?:is|are)/);
      expect(content).not.toMatch(/These are the forms published|you can create these \d+ forms/);
    },
  },
  {
    key: "generic-policy-review",
    text: "can you make a generic policy review form that works for any employee",
    check: (content) => {
      expect(content).toContain("are filled in for one employee at a time");
      expect(content).not.toMatch(/who is this form for/i);
    },
  },
];

export const NOV10_FORMS_GUIDE_CASES: ReplayCase[] = ASKS.flatMap((ask) =>
  ([
    ["lower", ask.text],
    ["sentence", ask.text[0]!.toUpperCase() + ask.text.slice(1)],
  ] as const).map(([casing, text]) => ({
    id: `nov10-forms-guide-${ask.key}-${casing}`,
    title: `"${text}" is answered from the form templates, with no card`,
    report: `${REPORT}; ${ask.key}, ${casing}`,
    status: { open: "answered by the model or knowledge base (or the whole inventory), not from the templates" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = await thread.say(text);
      expect(reply.content, `not answered from the templates:\n${reply.content}`).not.toBe(STAND_IN);
      ask.check(reply.content);
      expect(reply.formProposal, `a card came back:\n${reply.content}`).toBeUndefined();
    },
  })),
);
