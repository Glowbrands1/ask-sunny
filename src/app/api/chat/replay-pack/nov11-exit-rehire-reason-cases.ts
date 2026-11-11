import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A RUN-ON "… OTHER CAREER OPTIONS … REHIRE YES" FILLS REHIRE AND REASON (QA's October triage of #251, 10 Nov 2026;
 * EXIT_REHIRE_REASON_ENABLED)
 * ============================================================================
 *
 * #251's run-on (conv_mvofngxg2xy7l11), the person from the pack's STAFF: with production's flags the exit card lists
 * Eligible for Rehire and Reason for Resignation under "Left blank".
 */
const LEFT_BLANK = /\*\*Left blank for you to review:\*\*([^\n]*)/;

export const NOV11_EXIT_REHIRE_REASON_CASES: readonly ReplayCase[] = [
  {
    id: "nov11-exit-rehire-reason-run-on",
    title: '"… other career options items returned no deduct rehire yes": Eligible for Rehire and Reason for Resignation are filled, not left blank',
    report: "#251 (QA's October triage, 10 Nov 2026): the run-on left Eligible for Rehire and Reason for Resignation blank",
    status: { open: "Eligible for Rehire and Reason for Resignation are under \"Left blank\"" },
    fixFlags: ["EXIT_REHIRE_REASON_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t
        .thread()
        .say("exit form remy calder tc kearney gave notice 9/25 fulfilled 10/9 other career options items returned no deduct rehire yes");
      expect(reply.formProposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Remy Calder" });
      const blank = LEFT_BLANK.exec(reply.content)?.[1] ?? "";
      expect(blank, `Eligible for Rehire left blank:\n${reply.content}`).not.toMatch(/Eligible for Rehire/i);
      expect(blank, `Reason for Resignation left blank:\n${reply.content}`).not.toMatch(/Reason for Resignation/i);
    },
  },
];
