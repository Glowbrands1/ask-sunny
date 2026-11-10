import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * QA, live r19 (10 Nov 2026; COACHING_ASKS_WHAT_HAPPENED on in production): "create a coaching form for <T>" now asks
 * "You haven't told me what happened yet…", but the Coaching card beside it still offered an ACTIVE "Create draft"
 * (Employee only, no Details): the ask and the button contradict. The person here is invented (on the directory).
 */
const ASKS = /You haven't told me what happened yet/;

/** Whether the card offers Create (the card's `supportsInlineDraft`; the harness's proposal type does not list it). */
function createOffered(proposal: unknown): boolean | undefined {
  return (proposal as { supportsInlineDraft?: boolean } | null | undefined)?.supportsInlineDraft;
}

export const NOV10_ASKS_WHAT_HAPPENED_NO_CREATE_CASES: ReplayCase[] = [
  {
    id: "nov10-asks-what-happened-no-create",
    title: "\"create a coaching form for <name>\" asks what happened, and the card offers no Create until the account arrives",
    report: 'QA, live r19 (10 Nov 2026): "create a coaching form for <T>" — the ask shows, and so does an active "Create draft"',
    status: { open: "the reply asks what happened while the card offers an active Create draft (supportsInlineDraft true)" },
    fixFlags: ["COACHING_ASKS_WHAT_HAPPENED_ENABLED", "WHAT_HAPPENED_NO_CREATE_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const asked = await thread.say("create a coaching form for Rowan Kestrel");
      expect(asked.content, `the reply does not ask what happened:\n${asked.content}`).toMatch(ASKS);
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(createOffered(thread.proposal), "the card offers Create while the reply asks what happened").toBe(false);
      // The account arrives: the next card offers Create.
      await thread.say("she skipped the closing checklist on her shift last night");
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel after the account").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      expect(createOffered(thread.proposal), "the card offers no Create once the account is given").toBe(true);
    },
  },
];
