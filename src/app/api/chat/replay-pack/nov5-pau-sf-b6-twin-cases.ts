import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PAU'S sf-b6, TWIN (the sibling app's production, 4 Nov 2026; full transcript
 * relayed by QA, 5 Nov 2026), in this app's terms (salon)
 * ============================================================================
 *
 * Cases only: OPEN with today's production flags, no fixFlags until a fix
 * exists. The manager's turns are verbatim; the person is invented (Wynne
 * Sarrow). The answering model's turn-3 reply is the live one, verbatim: it
 * said no source states a policy and it would leave that field for the
 * manager — and the app ended the reply with "Based on what you've described,
 * I can prepare:" and nothing after it. The next card ignored the detail
 * added on turn 3.
 */

type T = ReplayContext;

const WYNNE: DirectoryRow = {
  id: "e-wynne-sarrow",
  firstName: "Wynne",
  lastName: "Sarrow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function pauSfB6TwinPeople(): readonly DirectoryRow[] {
  return [WYNNE];
}

const T3 =
  "can you have it include that we recieved a customer complaint from Sunday 11-1, she started closing the last register at 4:56pm and we cant close until the salon is closed at 5pm, we had a customer come in at 4:59 and was told them that we were closed";

/** The live answer to turn 3, verbatim (without the app's trailing lead). */
const LIVE_T3_ANSWER = `I can add that detail as the factual account on the form, but I want to flag something first: none of the sources available to me state a policy against closing a register before the salon's closing time, or a requirement tied to a specific till-closing minute — so I can't cite a policy breach on this point. The sources only describe the closing process steps, not a timing rule.

Here's what I can put on the Corrective Action Form:

**Incident detail (as reported):** On Sunday, 2026-11-01, a customer complaint was received stating that Wynne Sarrow began closing the last register at 4:56pm, before the salon's 5:00pm close. A customer who entered at 4:59pm was told the salon was closed.

I'll include that as the factual account — but the "policy breached in the manual's own words" field needs an actual cited policy. If you know which policy covers till/cash-handling timing near close, tell me and I'll pull it from the knowledge base; otherwise I'd leave that field for you to complete, since I can't state a policy that isn't in the sources.

Also still need from you:
- **Verbal or Written warning?**
- **Payroll deduct — Yes or No?**
- Any prior coaching/corrective action to note (I won't assume any).

Let me know and I'll fold it all together — then just say "create the corrective action form for Wynne Sarrow" when you're ready.`;

export const NOV5_PAU_SF_B6_TWIN_CASES: ReplayCase[] = [
  {
    id: "nov5-twin-sf-b6-full-sentence-and-added-detail",
    title: "sf-b6: the reply never ends at \"I can prepare:\"; the card after \"Create … from this conversation\" carries the detail added on turn 3",
    report: "Pau via QA, 5 Nov 2026 (the sibling app's production, 4 Nov), sf-b6 twin",
    status: { open: "the reply ends \"Based on what you've described, I can prepare:\" with nothing after it" },
    fixFlags: ["FORM_LEAD_FULL_SENTENCE_ENABLED"],
    async run(t: T) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, WYNNE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Which forms can I create here?");
      await thread.say("I need a corrective action form for Wynne Sarrow for counting the drawer early and turning away a customer");
      t.modelSays(LIVE_T3_ANSWER);
      const third = await thread.say(T3);
      expect(third.content.trim(), `the reply ends mid-sentence:\n${third.content}`).not.toMatch(/:\s*$/);
      t.modelSays(null);
      const card = await thread.say("Create a Corrective Action Form from this conversation.");
      expect(thread.proposal, `no Corrective Action card:\n${card.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      expect(card.content, `the card ignores the detail added on turn 3:\n${card.content}`).toMatch(/4:56|customer complaint|told (?:them )?(?:that )?(?:we|the (?:store|salon)) (?:were|was) closed/i);
    },
  },
];
