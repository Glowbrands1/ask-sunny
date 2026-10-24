import { describe, expect, it } from "vitest";

import { pickOpenIncidentDraft, type ResentDraftRow } from "./draft-reopen";

/**
 * A later chat for the same employee, template, and incident reopens the
 * open draft. A different day, or a different account of what happened,
 * does not.
 */

function row(overrides: Partial<ResentDraftRow>): ResentDraftRow {
  return {
    id: "draft-1",
    employeeName: "Paisley Peklo",
    locationId: "loc-0313",
    createdAt: "2026-10-20T15:00:00Z",
    formDate: "2026-10-20",
    narrative: "Opened the salon late and did not call.",
    ...overrides,
  };
}

describe("open draft for the same incident", () => {
  it("reopens another chat's draft for the same employee and date", () => {
    const id = pickOpenIncidentDraft(
      [row({ id: "older", createdAt: "2026-10-20T12:00:00Z" }), row({ id: "newer", createdAt: "2026-10-21T12:00:00Z", locationId: null })],
      {
        templateKey: "dpoa",
        employeeName: "paisley peklo",
        createdBy: "someone-else",
        locationId: null,
        formDate: "2026-10-20",
        incident: "She opened the salon late.",
      },
    );
    expect(id).toBe("newer");
  });

  it("does not reopen a draft for a different day or a different incident", () => {
    const rows = [row({})];
    expect(
      pickOpenIncidentDraft(rows, {
        templateKey: "dpoa",
        employeeName: "Paisley Peklo",
        createdBy: "sarah",
        locationId: "loc-0313",
        formDate: "2026-10-22",
        incident: "Opened the salon late and did not call.",
      }),
    ).toBeNull();
    expect(
      pickOpenIncidentDraft(rows, {
        templateKey: "dpoa",
        employeeName: "Paisley Peklo",
        createdBy: "sarah",
        locationId: "loc-0313",
        formDate: "2026-10-20",
        incident: "The cash drawer was short forty dollars at close.",
      }),
    ).toBeNull();
  });
});
