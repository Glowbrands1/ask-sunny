import { describe, expect, it } from "vitest";

import { pickOpenIncidentDraft, type ResentDraftRow, type ResentDraftWanted } from "./draft-reopen";

/**
 * ============================================================================
 * DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED — NEVER ANOTHER MANAGER'S DRAFT (QA, 25 OCT 2026)
 * ============================================================================
 *
 * QA: when a manager creates a form from chat, the create route can reopen an
 * open draft for the same employee, template and incident instead of filing
 * a new one, and that lookup did not ask who made the draft. Manager B could
 * be handed manager A's draft.
 *
 * On, the open-incident picker keeps only a draft whose creator is the
 * caller. Off, another manager's draft still counts, as it does today. The
 * route-level test is `src/app/api/forms/draft-reuse-own-only-oct25-route.test.ts`.
 * Every name here is invented.
 */

const DATE = "2026-10-20";

function row(overrides: Partial<ResentDraftRow>): ResentDraftRow {
  return {
    id: "draft-manager-a",
    employeeName: "Rowan Testcase",
    locationId: "loc-0313",
    createdAt: "2026-10-20T15:00:00Z",
    formDate: DATE,
    narrative: "Rowan opened the salon forty minutes late and did not call.",
    createdBy: "manager-a",
    ...overrides,
  };
}

function wanted(overrides: Partial<ResentDraftWanted> = {}): ResentDraftWanted {
  return {
    templateKey: "dpoa",
    employeeName: "rowan testcase",
    createdBy: "manager-b",
    locationId: "loc-0313",
    formDate: DATE,
    incident: "Rowan opened the salon late and did not call.",
    ...overrides,
  };
}

describe("DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED on: only the caller's own draft is reopened", () => {
  it("does not hand manager B manager A's matching open draft", () => {
    expect(pickOpenIncidentDraft([row({})], wanted({ ownDraftsOnly: true }))).toBeNull();
  });

  it("still reopens the caller's own matching draft, even when another manager's is newer", () => {
    const rows = [
      row({ id: "draft-manager-b", createdBy: "manager-b", createdAt: "2026-10-20T12:00:00Z" }),
      row({ id: "draft-manager-a", createdBy: "manager-a", createdAt: "2026-10-21T09:00:00Z" }),
    ];
    expect(pickOpenIncidentDraft(rows, wanted({ ownDraftsOnly: true }))).toBe("draft-manager-b");
  });

  it("matches the name whatever its case: lowercase and UPPERCASE give the same answer", () => {
    const rows = [row({}), row({ id: "draft-manager-b", createdBy: "manager-b" })];
    for (const employeeName of ["Rowan Testcase", "rowan testcase", "ROWAN TESTCASE", " rowan   TESTCASE "]) {
      expect(pickOpenIncidentDraft(rows, wanted({ ownDraftsOnly: true, employeeName }))).toBe("draft-manager-b");
      expect(pickOpenIncidentDraft([row({})], wanted({ ownDraftsOnly: true, employeeName }))).toBeNull();
      expect(pickOpenIncidentDraft([row({})], wanted({ employeeName }))).toBe("draft-manager-a");
    }
  });

  it("does not count a row whose creator was not read", () => {
    expect(pickOpenIncidentDraft([row({ createdBy: undefined })], wanted({ ownDraftsOnly: true }))).toBeNull();
    expect(pickOpenIncidentDraft([row({ createdBy: null })], wanted({ ownDraftsOnly: true }))).toBeNull();
  });
});

describe("DRAFT_REUSE_OWN_DRAFTS_ONLY_ENABLED off: today's behaviour is pinned", () => {
  it("another manager's matching open draft is reopened", () => {
    expect(pickOpenIncidentDraft([row({})], wanted())).toBe("draft-manager-a");
    expect(pickOpenIncidentDraft([row({})], wanted({ ownDraftsOnly: false }))).toBe("draft-manager-a");
  });

  it("a row with no creator read still counts, as before", () => {
    expect(pickOpenIncidentDraft([row({ createdBy: undefined })], wanted())).toBe("draft-manager-a");
  });
});
