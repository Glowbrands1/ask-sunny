import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "SHE SUBMITED HER NOTICE ON 9/29/26": THE NOTICE DATE IS SEPTEMBER 29 (QA's October triage, 10 Nov 2026;
 * EXIT_NOTICE_VERB_TYPOS_ENABLED)
 * ============================================================================
 *
 * The manager's wording, the person from the pack's STAFF: with production's flags the misspelled "submited" names
 * no notice date, and the card leaves "Date that notice was given" blank.
 */
export const NOV11_EXIT_NOTICE_VERB_TYPOS_CASES: readonly ReplayCase[] = [
  {
    id: "nov11-exit-notice-submited",
    title: '"… her last day will be 10/12/2026 and she submited her notice on 9/29/26": the notice date is September 29, 2026',
    report: "QA's October triage (10 Nov 2026): \"she submited her notice on 9/29/26\" left the notice date blank",
    status: { open: "\"Date that notice was given\" is left blank" },
    fixFlags: ["EXIT_NOTICE_VERB_TYPOS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t
        .thread()
        .say("exit form for remy calder her last day will be 10/12/2026 and she submited her notice on 9/29/26");
      expect(reply.formProposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Remy Calder" });
      expect(reply.content, `notice date not 9/29:\n${reply.content}`).toMatch(/\*\*Date that notice was given:\*\*\s*September 29, 2026/);
      expect(reply.content, `last day lost:\n${reply.content}`).toMatch(/\*\*Last Day Worked:\*\*\s*October 12, 2026/);
    },
  },
];
