import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * ONE NOTICE FOR A DRAFT THAT SAVED NO ACCOUNT (ONE_DRAFT_NOTICE_ENABLED; QA, 11 Nov 2026)
 * ============================================================================
 *
 * ported from the sibling app (QA, 11 Nov 2026): there, with DRAFT_WROTE_NOTHING_NOTICE and DRAFT_WRITE_NEVER_SILENT on, "make me a
 * coaching form for <invented>" → Create, the draft's write refused and no account, showed two notices and two "fill
 * it in below" offers, the first saying "Nothing was saved on this draft" though Name, Date, Job Title and Location
 * were saved. One notice: the field not saved, then what happened, asked once. The person is invented.
 */
const ISAURA: DirectoryRow = {
  id: "e-odn-isaura-quennell",
  firstName: "Isaura",
  lastName: "Quennell",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const BOTH = ["DRAFT_WRITE_NEVER_SILENT_ENABLED", "DRAFT_WROTE_NOTHING_NOTICE_ENABLED"];
const notices = (replies: readonly Record<string, unknown>[]) => replies.map((reply) => String(reply.notice ?? "")).join("\n");

export const NOV11_ONE_DRAFT_NOTICE_CASES: ReplayCase[] = [
  {
    id: "nov11-one-draft-notice-refused-no-account",
    title: "\"make me a coaching form for Isaura Quennell\" → Create, the write refused, no account: one notice, naming the field not saved, asking what happened once",
    report: "QA, 11 Nov 2026: two notices and two \"fill it in below\" offers, the first \"Nothing was saved on this draft\" though the header was saved",
    status: { open: "on production flags the draft says \"Nothing was saved on this draft\" though the header was saved; with both notice flags, two notices and two \"fill it in below\" offers" },
    fixFlags: [...BOTH, "ONE_DRAFT_NOTICE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-11T14:00:00Z"));
      t.directory([...STAFF, ISAURA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("make me a coaching form for Isaura Quennell");
      t.draftWrites({});
      t.draftWriteCarries!("stray_field");
      const id = await thread.create();
      const said = notices(t.draftReplies!());
      expect(t.values(id).employee_name ?? "", "the header was not saved").toBe("Isaura Quennell");
      expect(said, `says nothing was saved, though the header was:\n${said}`).not.toMatch(/Nothing was saved on this draft/);
      expect((said.match(/fill it in below/gi) ?? []).length, `"fill it in below" offered more than once:\n${said}`).toBe(1);
      expect((said.match(/what happened/gi) ?? []).length, `"what happened" asked more than once:\n${said}`).toBe(1);
      expect(said, `the field not saved is not named:\n${said}`).toMatch(/\*\*[^*]+\*\* (?:wasn't|weren't) saved/);
    },
  },
];
