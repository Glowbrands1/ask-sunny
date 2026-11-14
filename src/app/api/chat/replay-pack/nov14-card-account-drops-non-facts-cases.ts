import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE CARD'S ACCOUNT IS EVERY FACT SHE GAVE, AND NO HEDGE (CARD_ACCOUNT_DROPS_NON_FACTS_ENABLED)
 * ============================================================================
 *
 * Ask Bubbles' 17w live chat (QA, 14 Nov 2026), checked here in the manager's words; the person is the pack's invented one:
 *   t1 "<A> was late on 11/3/26", t2 "she yelled at a guest and she maybe forgot", t3 "corrective action form".
 * Ask Bubbles' first card showed only t2, hedge and all. This app's card shows the account as its Observation line, and
 * on production it read "Marnie Holloway was late on 11/3/26 she yelled at a guest and she maybe forgot": both facts,
 * joined with a space, the hedge kept (`ai/keep-filled-slots.ts`). Expected: the facts joined with "; ", no hedge.
 */

const T1 = "Marnie Holloway was late on 11/3/26";
const T2 = "she yelled at a guest and she maybe forgot";
const T3 = "corrective action form";
const REPORT = "Ask Bubbles' 17w live chat via QA (14 Nov 2026): the card's account was \"she yelled at a customer and she maybe forgot\"; the lateness dropped, the hedge kept";

export const NOV14_CARD_ACCOUNT_DROPS_NON_FACTS_CASES: ReplayCase[] = [
  {
    id: "nov14-card-account-three-turns-both-facts-no-hedge",
    title: `"${T1}" → "${T2}" → "${T3}": the card's Observation holds both facts, the lateness first, and no hedge`,
    report: REPORT,
    status: { open: "the Observation is every turn joined with a space, hedge included: \"Marnie Holloway was late on 11/3/26 she yelled at a guest and she maybe forgot\"" },
    fixFlags: ["CARD_ACCOUNT_DROPS_NON_FACTS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      const reply = await thread.say(T3);
      const observation = (reply.content.match(/^\*\*Observation of Offense:\*\*\s*(.*)$/m) ?? [])[1] ?? "";
      expect(observation, `no Observation line:\n${reply.content}`).not.toBe("");
      expect(observation, `the lateness was dropped:\n${reply.content}`).toMatch(/late on 11\/3\/26/i);
      expect(observation, `the guest was dropped:\n${reply.content}`).toMatch(/yelled at a guest/i);
      expect(observation, "the hedge is on the card").not.toMatch(/maybe|forgot/i);
      expect(observation).toBe("Marnie Holloway was late on 11/3/26; she yelled at a guest");
    },
  },
];
