import { describe, expect, it } from "vitest";

import type { InstanceRow } from "./instances";
import { followUpNoticeStage, runFollowUpNotices, type FollowUpNoticeDeps } from "./follow-up-notices";

/*
 * Pau, 26 Nov 2026: "for the follow up, this is when the manager will follo up with the person, when its due and overdue
 * pls add a notification whoever created the form". Names here are invented.
 */
const NOW = new Date("2026-11-26T18:00:00Z"); // 26 Nov in the business time zone

function form(overrides: Partial<InstanceRow>): InstanceRow {
  return {
    id: "f-1",
    employeeName: "Marlo Quint",
    templateShortName: "Corrective Action",
    locationName: null,
    locationId: null,
    createdBy: "manager-1",
    status: "finalized",
    followUpDate: "2026-11-26",
    followedUpAt: null,
    ...overrides,
  } as InstanceRow;
}

function harness(forms: InstanceRow[], emails: Record<string, string | null> = { "manager-1": "manager@example.test" }) {
  const claimed = new Set<string>();
  const rung: { recipientEmail: string; kind: string; title: string; body: string; href: string | null }[] = [];
  const deps: FollowUpNoticeDeps = {
    list: async () => forms,
    claim: async (row) => {
      const key = `${row.instanceId}|${row.stage}|${row.followUpDate}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    emailOf: async (id) => emails[id] ?? null,
    ring: async (rows) => {
      rung.push(...rows);
    },
    excludedNames: new Set(),
  };
  return { deps, rung };
}

describe("when its due and overdue pls add a notification whoever created the form", () => {
  it("rings the creator's bell on the day the follow-up is due", async () => {
    const { deps, rung } = harness([form({})]);
    const outcome = await runFollowUpNotices(NOW, deps);
    expect(outcome).toMatchObject({ due: 1, overdue: 0 });
    expect(rung).toEqual([
      expect.objectContaining({
        recipientEmail: "manager@example.test",
        kind: "form_follow_up_due",
        title: "Follow-up due today",
        body: expect.stringContaining("Corrective Action for Marlo Quint"),
      }),
    ]);
  });

  it("rings it again once the follow-up is overdue, naming the date it was due", async () => {
    const { deps, rung } = harness([form({ followUpDate: "2026-11-24" })]);
    await runFollowUpNotices(NOW, deps);
    expect(rung).toEqual([
      expect.objectContaining({ kind: "form_follow_up_overdue", title: "Follow-up overdue", body: expect.stringContaining("Nov 24") }),
    ]);
  });

  it("sends each notice once, however often the job runs", async () => {
    const { deps, rung } = harness([form({})]);
    await runFollowUpNotices(NOW, deps);
    const second = await runFollowUpNotices(NOW, deps);
    expect(second).toMatchObject({ due: 0, alreadySent: 1 });
    expect(rung).toHaveLength(1);
  });

  it("sends nothing for a follow-up already marked done, one not yet due, a draft or a replaced version", async () => {
    const { deps, rung } = harness([
      form({ id: "done", followUpDate: "2026-11-20", followedUpAt: "2026-11-21T12:00:00Z" }),
      form({ id: "later", followUpDate: "2026-12-01" }),
      form({ id: "draft", status: "draft" }),
      form({ id: "old", status: "revised", followUpDate: "2026-11-20" }),
    ]);
    await runFollowUpNotices(NOW, deps);
    expect(rung).toHaveLength(0);
  });

  it("goes only to whoever created the form, and skips a creator with no account email", async () => {
    const { deps, rung } = harness(
      [form({ id: "a", createdBy: "manager-1" }), form({ id: "b", createdBy: "gone" })],
      { "manager-1": "manager@example.test", gone: null },
    );
    const outcome = await runFollowUpNotices(NOW, deps);
    expect(rung.map((row) => row.recipientEmail)).toEqual(["manager@example.test"]);
    expect(outcome.noRecipient).toBe(1);
  });

  it("knows the stage from the dates alone", () => {
    expect(followUpNoticeStage(form({}), "2026-11-26")).toBe("due");
    expect(followUpNoticeStage(form({ followUpDate: "2026-11-25" }), "2026-11-26")).toBe("overdue");
    expect(followUpNoticeStage(form({ followUpDate: "2026-11-27" }), "2026-11-26")).toBeNull();
  });
});
