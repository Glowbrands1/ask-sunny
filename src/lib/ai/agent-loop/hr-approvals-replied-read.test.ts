import { describe, expect, it } from "vitest";

import { DEFAULT_DATA_TOOL_DEPS, readHrApprovals, type HrApprovalsRead } from "./data-tools";

/**
 * read_hr_approvals for HR (Pau, via QA, 23 Nov 2026; CLAUDE.md rule 5): a form HR sent back that the manager has
 * replied to needs HR's decision now, as the "Manager replied to changes" row on Form Monitoring does. The AI lists it
 * with the forms waiting for HR, saying the manager replied and HR may approve it; a sent-back form with no reply stays
 * with the ones waiting on the manager. Invented forms.
 */
const queue: HrApprovalsRead = {
  kind: "hr",
  queue: [
    { line: "Corrective Action Form for Invented Waiting at KC Wornall", createdByName: "Marigold", state: "pending", requestedAt: "2026-11-23T15:00:00Z", waiting: "Sent today", overdue: false, managerReplied: false },
    { line: "Corrective Action Form for Invented Replied at KC Wornall", createdByName: "Marigold", state: "changes_requested", requestedAt: "2026-11-22T15:00:00Z", waiting: "Waiting 1 business day", overdue: false, managerReplied: true },
    { line: "Corrective Action Form for Invented Sentback at KC Wornall", createdByName: "Marigold", state: "changes_requested", requestedAt: "2026-11-21T15:00:00Z", waiting: "Waiting 2 business days", overdue: false, managerReplied: false },
  ],
};

describe("read_hr_approvals: a sent-back form the manager replied to needs HR (Pau)", () => {
  it("is listed with the forms waiting for HR, marked as replied; the one with no reply stays sent back", async () => {
    const context = { actor: { role: "district_manager", scope: null, subject: "hr-fenwick", verified: true }, question: "what's waiting on me?", scopeId: "scope-1", today: "2026-11-23" } as never;
    const result = (await readHrApprovals(context, { ...DEFAULT_DATA_TOOL_DEPS, loadHrApprovals: async () => queue })) as Record<string, unknown>;
    const waiting = JSON.stringify(result.waiting_for_you);
    expect(waiting).toContain("Invented Waiting");
    expect(waiting).toContain("Invented Replied");
    expect(waiting).toMatch(/manager replied to changes/);
    const sentBack = JSON.stringify(result.sent_back_or_rejected);
    expect(sentBack).toContain("Invented Sentback");
    expect(sentBack).not.toContain("Invented Replied");
  });
});
