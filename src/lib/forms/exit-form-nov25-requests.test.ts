import { describe, expect, it } from "vitest";

import { exitFormDocument, EXIT_YES_NO_QUESTIONS, EXIT_TEMPLATE_SEEDS } from "./exit-library";
import { exitFactValues, readExitFacts } from "./exit-facts";
import {
  exitSubmissionProblems,
  isCompleteMailingAddress,
  isExitDocument,
  noticeDatesLocked,
  noticeDatesToClear,
} from "./exit-submission-rules";
import { blankBeforeSubmission } from "./required-fields";
import { wovenAddressLine, wovenAddressShape, exitEmployeeDirectoryId } from "./exit-woven-address";

/**
 * Pau, 25 Nov 2026, on the Exit Form (their words):
 *
 *   "Can we also change the question, Written Notice Attached? To: Is written notice uploaded to the employee file?"
 *   "Can you make it so that dates can NOT be entered into the Date that notice was given and Date that notice was
 *    fulfilled fields UNLESS Submitted & Fulfilled Notice box is checked?"
 *   "Permanent Address should capture the complete mailing address, including zip"
 *   "On the Exit, if none of the Resignation Details boxes are checked, can Sunny/Bubbles prevent the form from being
 *    submitted until 1 box is checked?"
 *   "On the Exit Form, can the parameters be set so that every field must be completed or the form will not submit to
 *    HR?"
 *   "i have access to that in woven why didnt my address populate in form?"
 *
 * Invented people and addresses only.
 */

const document = exitFormDocument();
type Row = { fieldKey: string; value: string | null; checked?: string[] };

/** A fully completed exit form (voluntary resignation, notice not involved). */
function complete(overrides: Record<string, string | string[] | null> = {}): Row[] {
  const base: Record<string, string | string[]> = {
    employee_name: "Remy Calder",
    form_date: "2026-11-25",
    job_title: "Tanning Consultant",
    location: "Test Salon",
    permanent_address: "412 Ashgrove Ln, Apt 3, Lincoln, NE 68508",
    last_day_worked: "2026-11-20",
    resignation_type: ["immediate_voluntary_resignation"],
    store_items_returned: ["yes"],
    salon_key_returned: ["yes"],
    payroll_deduction_applicable: ["no"],
    forfeit_bonus: ["no"],
    dropped_to_minimum_wage: ["no"],
    written_notice_attached: ["no"],
    eligible_for_rehire: ["yes"],
    resignation_date: "2026-11-20",
    resignation_method: "In person",
    resignation_reason: "Moving away",
  };
  const merged: Record<string, string | string[] | null> = { ...base, ...overrides };
  return Object.entries(merged)
    .filter(([, value]) => value !== null)
    .map(([fieldKey, value]) =>
      Array.isArray(value) ? { fieldKey, value: null, checked: value } : { fieldKey, value: value as string },
    );
}

describe("Exit form requests, 25 Nov 2026", () => {
  it('"Written Notice Attached?" reads "Is written notice uploaded to the employee file?" (same key, so filed forms keep their answer)', () => {
    const question = EXIT_YES_NO_QUESTIONS.find((entry) => entry.key === "written_notice_attached");
    expect(question?.label).toBe("Is written notice uploaded to the employee file?");
    expect(JSON.stringify(document)).not.toContain("Written notice attached?");
    expect(EXIT_TEMPLATE_SEEDS[0]!.revision).toBeGreaterThanOrEqual(3);
  });

  it("the notice dates are locked until Submitted & Fulfilled Notice is ticked", () => {
    expect(noticeDatesLocked([])).toBe(true);
    expect(noticeDatesLocked(undefined)).toBe(true);
    expect(noticeDatesLocked(["submitted_fulfilled_notice"])).toBe(false);
    // A write that leaves the box unticked clears whatever dates are there.
    expect(noticeDatesToClear([], { notice_given_date: "2026-11-01", notice_fulfilled_date: "2026-11-15" })).toEqual([
      "notice_given_date",
      "notice_fulfilled_date",
    ]);
    expect(noticeDatesToClear(["submitted_fulfilled_notice"], { notice_given_date: "2026-11-01" })).toEqual([]);
  });

  it("a notice date the manager states is put on the form only when the notice was fulfilled", () => {
    const unfulfilled = readExitFacts("Remy gave her two weeks notice on 11/1/2026 but walked out on 11/5/2026 and never came back", "2026-11-25");
    const values = exitFactValues(unfulfilled).values;
    expect(values.notice_given_date).toBeUndefined();
    expect(values.notice_fulfilled_date).toBeUndefined();
  });

  it('"Permanent Address should capture the complete mailing address, including zip"', () => {
    expect(isCompleteMailingAddress("412 Ashgrove Ln, Lincoln, NE 68508")).toBe(true);
    expect(isCompleteMailingAddress("412 Ashgrove Ln, Apt 3, Lincoln, Nebraska 68508-1234")).toBe(true);
    expect(isCompleteMailingAddress("PO Box 77, Kearney NE 68845")).toBe(true);
    expect(isCompleteMailingAddress("412 Ashgrove Ln")).toBe(false);
    expect(isCompleteMailingAddress("412 Ashgrove Ln, Lincoln, NE")).toBe(false);
    expect(isCompleteMailingAddress("412 Ashgrove Ln, Lincoln 68508")).toBe(false);
    expect(isCompleteMailingAddress("Ashgrove Ln, Lincoln, NE 68508")).toBe(false);

    expect(exitSubmissionProblems(document, null, complete())).toEqual([]);
    expect(exitSubmissionProblems(document, null, complete({ permanent_address: "412 Ashgrove Ln" }))).toEqual([
      { key: "permanent_address", label: "Permanent Address" },
    ]);
  });

  it('"if none of the Resignation Details boxes are checked … prevent the form from being submitted until 1 box is checked"', () => {
    const blank = blankBeforeSubmission(document, null, complete({ resignation_type: null }));
    expect(blank.map((part) => part.key)).toContain("resignation_type");
    // Submitted & Fulfilled Notice is a box too: ticked with its dates, nothing else is asked for.
    const fulfilled = blankBeforeSubmission(
      document,
      null,
      complete({
        resignation_type: null,
        resignation_notice: ["submitted_fulfilled_notice"],
        notice_given_date: "2026-11-01",
        notice_fulfilled_date: "2026-11-15",
      }),
    );
    expect(fulfilled).toEqual([]);
  });

  it('"every field must be completed or the form will not submit to HR": the exit form is always checked, a complete one passes', () => {
    expect(isExitDocument(document)).toBe(true);
    expect(blankBeforeSubmission(document, null, complete())).toEqual([]);
    const missing = blankBeforeSubmission(document, null, complete({ permanent_address: null, eligible_for_rehire: null }));
    expect(missing.map((part) => part.key)).toEqual(["permanent_address", "eligible_for_rehire"]);
  });

  it('"why didnt my address populate": Woven bodies with a flat or listed address are read, and a rehire is still one person', () => {
    expect(wovenAddressLine({ Address: "412 Ashgrove Ln", City: "Lincoln", State: "NE", Zip: "68508" })).toBe(
      "412 Ashgrove Ln, Lincoln, NE 68508",
    );
    expect(wovenAddressLine({ Addresses: [{ Address1: "77 Larkspur Ct", City: "Kearney", StateCode: "NE", PostalCode: "68845" }] })).toBe(
      "77 Larkspur Ct, Kearney, NE 68845",
    );
    expect(wovenAddressLine({ Employee: { Address: { Address1: "9 Elm St", City: "Hastings", State: "NE", ZipCode: "68901" } } })).toBe(
      "9 Elm St, Hastings, NE 68901",
    );
    const rows = [
      { id: "old", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["s1"] },
      { id: "now", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["s1"] },
    ];
    expect(exitEmployeeDirectoryId(rows, "Remy Calder", { level: "global" } as never)).toBe("now");
  });

  it('"not showing address" (26 Nov 2026): Woven sends Address as one string with no City, State or Zip beside it', () => {
    // The production body's shape, from the log: Address is a plain value at the top, next to EmployeeID and the rest.
    const body = { EmployeeID: 1, EmailAddress: "someone@example.test", Address: "412 Ashgrove Ln, Kearney, NE 68847" };
    expect(wovenAddressLine(body)).toBe("412 Ashgrove Ln, Kearney, NE 68847");
    expect(wovenAddressLine({ ...body, Address: "412 Ashgrove Ln\nKearney, NE 68847" })).toBe("412 Ashgrove Ln, Kearney, NE 68847");
    // A street alone is not a mailing address: the line stays blank rather than half filled.
    expect(wovenAddressLine({ ...body, Address: "412 Ashgrove Ln" })).toBeNull();
    expect(wovenAddressLine({ ...body, Address: null })).toBeNull();
    // The log describes the value without ever printing it.
    const shape = wovenAddressShape({ ...body, Address: "412 Ashgrove Ln" });
    expect(shape).toContain("Address=string(length 15, has digits, no ZIP, 0 commas)");
    expect(shape).not.toContain("Ashgrove");
    expect(wovenAddressShape({ ...body, Address: null })).toContain("Address=null");
  });

  it("two current Woven records with one name (a corporate one and a location one): the one at the form's location", () => {
    const rows = [
      { id: "corporate", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["hq"] },
      { id: "location", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["s1"] },
    ];
    const scope = { level: "global" } as never;
    // Without the form's location the two cannot be told apart, so nothing is guessed.
    expect(exitEmployeeDirectoryId(rows, "Remy Calder", scope)).toBeNull();
    expect(exitEmployeeDirectoryId(rows, "Remy Calder", scope, "s1")).toBe("location");
    expect(exitEmployeeDirectoryId(rows, "Remy Calder", scope, "hq")).toBe("corporate");
    // A location neither record is at still guesses nothing.
    expect(exitEmployeeDirectoryId(rows, "Remy Calder", scope, "s9")).toBeNull();
  });
});
