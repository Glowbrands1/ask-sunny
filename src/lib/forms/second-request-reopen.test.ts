import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import { reopenIncidentText } from "./current-request";
import { pickResentDraft, type ResentDraftRow } from "./draft-reopen";

/**
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's audit, 7 Nov 2026): DRAFT_DEDUPE's lookup (`ai/grounded-turn.ts`
 * reopenSameIncident → `draft-reopen.ts`) read every manager turn of the chat as the incident, so a second Corrective
 * Action for the same person matched the first draft and reopened it — no second form, and the second request's
 * account went onto the first draft. The person is invented.
 */
const FIRST = "create a corrective action for Remy Calder, he was late opening the salon";
const SECONDS = [
  "I need another corrective action for Remy Calder, his cash drawer was short $20",
  "now make a separate CA for Remy Calder for his cash drawer being short $20",
  "create a corrective action for Remy Calder, his cash drawer was short $20",
];
const NARRATIVES = ["Observed:\nRemy was late opening the salon.", "Observed:\nRemy was late opening the salon on 11/2.\nExpectation:\nOpen the salon on time."];
const DATES: ReadonlyArray<[string | null, string | null]> = [
  [null, null],
  ["2026-11-03", null],
  [null, "2026-11-02"],
  ["2026-11-02", "2026-11-02"],
];

const firstDraft = (narrative: string, formDate: string | null): ResentDraftRow => ({
  id: "first-draft",
  employeeName: "Remy Calder",
  locationId: "loc-0309",
  createdAt: "2026-11-07T00:00:00Z",
  narrative,
  formDate,
});

const lookUp = (turns: readonly string[], ownRequest: boolean, narrative: string, [wanted, row]: [string | null, string | null]) =>
  pickResentDraft([firstDraft(narrative, row)], {
    templateKey: "dpoa",
    employeeName: "Remy Calder",
    createdBy: "manager",
    locationId: "loc-0309",
    incident: reopenIncidentText(turns, ownRequest),
    formDate: wanted,
  });

describe("the reopen lookup's incident (SECOND_REQUEST_OWN_ACCOUNT_ENABLED)", () => {
  it("off (as before): the whole chat matches the first draft, so a second request reopens it unless both dates differ", () => {
    expect(lookUp([FIRST, SECONDS[0]!], false, NARRATIVES[0]!, [null, null])).toBe("first-draft");
  });

  it("on: a second request with its own incident never reopens the first draft, whatever the dates", () => {
    for (const second of SECONDS) {
      for (const narrative of NARRATIVES) {
        for (const dates of DATES) {
          expect(lookUp([FIRST, "no payroll deduct", second], true, narrative, dates), `${second} / ${JSON.stringify(dates)}`).toBeNull();
        }
      }
    }
  });

  it("on: a genuine resend of the same request still reopens its draft (DRAFT_DEDUPE's purpose)", () => {
    const resend = "create a corrective action for Remy Calder, he was late opening the salon";
    for (const narrative of NARRATIVES) {
      expect(lookUp([FIRST, "no payroll deduct", resend], true, narrative, [null, null])).toBe("first-draft");
      expect(lookUp([FIRST, resend], true, narrative, ["2026-11-02", "2026-11-02"])).toBe("first-draft");
    }
  });

  it("on: follow-ups to the first request (no new form asked) are still the first request's incident", () => {
    expect(reopenIncidentText([FIRST, "no payroll deduct"], true)).toBe(`${FIRST}\nno payroll deduct`);
  });

  it("off: the incident is every turn joined, exactly as before", () => {
    expect(reopenIncidentText([FIRST, SECONDS[0]!], false)).toBe(`${FIRST}\n${SECONDS[0]!}`);
  });
});
