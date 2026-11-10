import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * TWO NAMES IN ONE REQUEST (QA, 5 Nov 2026, found porting the sibling app's two-forms fix)
 * ============================================================================
 *
 * A manager asks for two forms for two different people in one message. The
 * sibling app makes two cards; this app has no multi-form reply, and asks
 * "Which person did you mean for **Marnie Holloway**? 1. **Marnie Holloway** …
 * 2. **Remy Calder** …" — offering the OTHER person as a match for the first
 * name, although both are typed in full and both are on the roster. Recorded
 * OPEN for QA's list (a separate item: two names in one request, a multi-form
 * request here). The people are the pack's invented fixture roster.
 */
const MESSAGE = "I need a coaching form for Marnie Holloway for her customer service at the register, and a CA for Remy Calder for opening the salon late on 11/2";

export const NOV5_TWO_NAMES_ONE_REQUEST_CASES: ReplayCase[] = [
  {
    id: "nov5-two-names-one-request-no-cross-match",
    title: "\"a coaching form for Marnie Holloway … and a CA for Remy Calder …\": never \"Which person did you mean for **Marnie Holloway**?\" offering Remy Calder",
    report: "QA, 5 Nov 2026: this app's reply to a two-form request for two people asks which person was meant for the first, listing the second",
    // Changed on purpose (8 Nov 2026): fixed in production by TWO_FORMS_EACH_PERSON_ENABLED, QA round 4, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(MESSAGE);
      expect(reply.content, `the other person is offered as a match for Marnie Holloway:\n${reply.content}`).not.toMatch(/Which person did you mean for \*\*Marnie Holloway\*\*/);
    },
  },
];
