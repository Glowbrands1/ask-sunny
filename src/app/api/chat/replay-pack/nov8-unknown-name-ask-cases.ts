import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A NAME NOT ON THE DIRECTORY IS NAMED BACK; THE NAME QUESTION IS NEVER REPEATED (QA's round-6 audit, 8 Nov 2026)
 * ============================================================================
 *
 * QA's audit ran the sibling app's BF7 chain (QA live there, 27 Oct 2026; there UNKNOWN_NAME_ASK_ENABLED is live) in
 * this app, with this app's words: "i need to issue a ca for someone being late" / "quinn marlowe was late on 10/20
 * and the salon was opened late" / "she was issued a verbal ca on 10.1 for this same thing" / "yes payroll deduct" /
 * "i dont know the amount" / "kearney". All six replies asked "Who is this **Corrective Action Form** for? Give me
 * their name and I'll draft it …" (every other one behind "I still need to know who this is for"), and the typed name
 * was never said back. UNKNOWN_NAME_ASK_ENABLED (`ai/unknown-name-ask.ts`). The tester's words; the name is invented
 * and on no directory.
 */
const CHAIN = [
  "i need to issue a ca for someone being late",
  "quinn marlowe was late on 10/20 and the salon was opened late",
  "she was issued a verbal ca on 10.1 for this same thing",
  "yes payroll deduct",
  "i dont know the amount",
  "kearney",
];
const FIX = ["UNKNOWN_NAME_ASK_ENABLED"];
const REPORT = "QA's round-6 audit (8 Nov 2026), the sibling app's BF7 chain: the name question five times, the typed name never read";
// Changed on purpose (coding 2, 8 Nov 2026): `ai/server-ask.ts` now calls withUnknownNameAsk inside withStatedAmount,
// so both cases hold with their fix flag and the `fixStatus: ROUTE` lines are gone.

async function chain(t: ReplayContext): Promise<string[]> {
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const out: string[] = [];
  for (const turn of CHAIN) out.push((await thread.say(turn)).content);
  return out;
}

export const NOV8_UNKNOWN_NAME_ASK_CASES: ReplayCase[] = [
  {
    id: "nov8-unknown-name-ask-named-back",
    title: "the BF7 chain: the typed name not on the directory is named back",
    report: REPORT,
    status: { open: "\"quinn marlowe\" is never said back; every reply asks \"Who is this Corrective Action Form for?\"" },
    fixFlags: FIX,
    async run(t) {
      const out = await chain(t);
      expect(out.some((reply) => /\*\*quinn marlowe\*\*[^\n]*directory/i.test(reply)), `the typed name is never named back:\n${out.join("\n---\n")}`).toBe(true);
    },
  },
  {
    id: "nov8-unknown-name-ask-no-repeat",
    title: "the BF7 chain: no reply asks the name question in the same words as the reply before",
    report: REPORT,
    status: { open: "\"Who is this **Corrective Action Form** for? Give me their name …\" on every turn" },
    fixFlags: FIX,
    async run(t) {
      const out = await chain(t);
      const ask = (reply: string) => /Who is this \*\*Corrective Action Form\*\* for\? Give me their name/.test(reply);
      for (let index = 1; index < out.length; index += 1) {
        expect(ask(out[index]!) && ask(out[index - 1]!), `reply ${index} asks as the one before:\n${out[index - 1]}\n---\n${out[index]}`).toBe(false);
      }
    },
  },
];
