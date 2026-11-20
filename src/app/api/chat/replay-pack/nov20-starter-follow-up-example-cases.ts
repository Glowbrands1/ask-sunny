import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A HOME STARTER'S FOLLOW-UP CARRIES ONE EXAMPLE ANSWER (QA item 24, the production audit, 20 Nov 2026)
 * ============================================================================
 *
 * Managers tapped the home starter "Create a coaching form." (and "Show me training related to this issue.") with
 * nothing else said; Sunny asked who it was for, and three managers left. With STARTER_FOLLOW_UP_EXAMPLE_ENABLED the
 * who-question carries one short example ("For example: \"coaching for <name> on greeting guests\"."). A starter sent
 * later in a chat, or a request that names the person, is unchanged.
 */

const FIX = ["STARTER_FOLLOW_UP_EXAMPLE_ENABLED"];
const REPORT = "QA item 24 (production audit, 20 Nov 2026): \"Create a coaching form.\" got \"who?\" with no help, and managers left";
const EXAMPLE = 'For example: "coaching for <name> on greeting guests".';

export const NOV20_STARTER_FOLLOW_UP_EXAMPLE_CASES: ReplayCase[] = [
  {
    id: "nov20-starter-coaching-form-who-has-example",
    title: "Item 24: the home starter \"Create a coaching form.\" as the first message: the who-question carries one example answer",
    report: REPORT,
    status: { open: "STARTER_FOLLOW_UP_EXAMPLE_ENABLED is off in production" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("Create a coaching form.");
      expect(reply.content, `the reply does not ask who:\n${reply.content}`).toMatch(/Who is this (?:\*\*Coaching Form\*\*|form) for\?/);
      expect(reply.content, `no example answer:\n${reply.content}`).toContain(EXAMPLE);
    },
  },
  {
    id: "nov20-starter-control-named-request-unchanged",
    title: "Item 24 control: \"Create a coaching form for Remy Calder on greeting guests\" names the person: no example line",
    report: `${REPORT}; only the bare starter`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("Create a coaching form for Remy Calder on greeting guests");
      expect(reply.content).not.toContain(EXAMPLE);
    },
  },
];
