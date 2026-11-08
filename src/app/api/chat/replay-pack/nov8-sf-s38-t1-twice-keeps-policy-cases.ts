import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * sf-s38, THE SAME REQUEST SENT TWICE KEEPS ITS POLICY (QA's round-6 gate, 8 Nov 2026; gate runner 2's bisect: Sunny
 * round 6 rolled back). With SECOND_REQUEST_OWN_ACCOUNT_ENABLED on, the manager's T1 sent a second time was read as a
 * new request (`ai/form-state.ts` stateForTurn): turn 2's card lost its Policy line, and its Action Plan said "the
 * applicable company policy" instead of Attendance, page 14. The manager's words; the employee is the pack's invented
 * Rowan Kestrel (as in nov8-sf-s38-card-meta). Also one near-identical resend: the same request with its typo fixed and
 * a closing "please".
 */
const T1 = "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const REPORT = "QA's round-6 gate, 8 Nov 2026 (sf-s38, Sunny production 7 Nov): T1 sent twice, turn 2 lost the Policy line";

function policyLine(content: string): string {
  return content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

export const NOV8_SF_S38_T1_TWICE_KEEPS_POLICY_CASES: ReplayCase[] = [
  ...(
    [
      ["t1-twice", T1],
      ["typo-fixed-please", `${T1.replace("proporley", "properly")} please`],
    ] as const
  ).map(
    ([key, again]): ReplayCase => ({
      id: `nov8-sf-s38-${key}-keeps-policy`,
      title: `sf-s38: T1, then "${again.length > 60 ? `${again.slice(0, 30)}…${again.slice(-25)}` : again}": turn 2 keeps the Attendance policy and its Action Plan`,
      report: REPORT,
      // production-flags.json lists round 6 (SECOND_REQUEST_OWN_ACCOUNT on; Vercel rolled back to round 5): with it, t1-twice
      // fails before the fix and holds after. The near-identical resend already held through the route; its unit rows
      // (`ai/form-state-resend.test.ts`) fail before the fix.
      status: "fixed",
      fixFlags: ["SECOND_REQUEST_OWN_ACCOUNT_ENABLED"],
      async run(t) {
        vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
        t.directory(STAFF);
        t.as("salon_director", KEARNEY);
        // The live card cited Attendance (page 14) from the models' reading of "missing her saturday and sunday shifts".
        t.slotsRead({ policyHeading: "Attendance" });
        const thread = t.thread();
        const first = await thread.say(T1);
        expect(policyLine(first.content), `turn 1 cites no Attendance policy (the premise):\n${first.content}`).toMatch(/Attendance/);
        const second = await thread.say(again);
        expect(policyLine(second.content), `turn 2 lost the Policy line:\n${second.content}`).toMatch(/Attendance/);
        expect(second.content, `turn 2's Action Plan fell back to "the applicable company policy":\n${second.content}`).not.toMatch(/\*\*Action Plan:\*\*[^\n]*applicable company policy/i);
      },
    }),
  ),
];
