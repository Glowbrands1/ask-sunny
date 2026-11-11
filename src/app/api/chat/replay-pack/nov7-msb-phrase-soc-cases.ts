import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "MUST SEE BEHAVIORS" SPELLED OUT CITES THE STANDARDS OF CONDUCT (Pau via QA, 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employee invented): "create a ca for must see behaviors for <name>". The card cited no
 * policy; "create a ca for MSB for <name>" cites the Standards of Conduct (CA_SALES_POLICY_ENABLED). Pau: MSB is
 * the Standards of Conduct. MSB_PHRASE_SOC_ENABLED. CA_SALES_POLICY_ENABLED and AS_YOU_SAID_MANAGER_WORDS_ENABLED
 * are live in production (QA) and are named here too, in case the flags file is behind.
 */

const WRENNA: DirectoryRow = {
  id: "e-wrenna-calloway-msb",
  firstName: "Wrenna",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

export const NOV7_MSB_PHRASE_SOC_CASES: ReplayCase[] = [
  {
    id: "nov7-msb-phrase-soc",
    title: "\"create a ca for must see behaviors for <name>\" cites the Standards of Conduct, with no \"as you said\"",
    report: "Pau via QA, 7 Nov 2026 (MSB = Standards of Conduct)",
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["MSB_PHRASE_SOC_ENABLED", "CA_SALES_POLICY_ENABLED", "AS_YOU_SAID_MANAGER_WORDS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:00:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a ca for must see behaviors for Wrenna Calloway");
      expect(thread.proposal, "no CA card").toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, "the card cites no Standards of Conduct").toMatch(/Standards of Conduct/);
      expect(reply.content.split("\n").filter((line) => /Standards of Conduct/.test(line) && /as you said/i.test(line))).toEqual([]);
    },
  },
];
