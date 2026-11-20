import { describe, expect, it } from "vitest";

import { draftNotesFromCard, notesWithoutCardLines } from "./draft-notes";
import { addressTypedIn, withoutUntypedAddresses } from "./exit-details";

/**
 * Item 19 (Pau via QA, 17 and 20 Nov 2026): the exit form's Permanent Address is only ever an address the manager typed in
 * the chat. Invented addresses only.
 */
const ADDRESS = "412 Ashgrove Ln, Kearney, NE 68847";

describe("only the manager's own address (item 19)", () => {
  it("an address is the manager's when it is in what they typed, spacing and punctuation aside", () => {
    expect(addressTypedIn(ADDRESS, `her home address is 412 ashgrove ln kearney ne 68847`)).toBe(true);
    expect(addressTypedIn(ADDRESS, "exit form for remy calder, she quit without notice")).toBe(false);
    expect(addressTypedIn("", "anything")).toBe(false);
  });

  it("an account the model wrote loses a labelled address the manager never typed, label and all", () => {
    const read = withoutUntypedAddresses(`Quit without notice. Home address ${ADDRESS}.`, "exit form for remy calder, she quit without notice");
    expect(read.text).toBe("Quit without notice.");
    expect(read.removed).toEqual([ADDRESS]);
    expect(withoutUntypedAddresses(`She quit; her permanent address is ${ADDRESS}, last day 11/12.`, "she quit").text).not.toMatch(/Ashgrove|address/);
  });

  it("an address the manager typed stays, and an account with none is untouched", () => {
    const typed = `Quit without notice. Home address ${ADDRESS}.`;
    expect(withoutUntypedAddresses(typed, `she quit without notice. her home address is ${ADDRESS}`)).toEqual({ text: typed, removed: [] });
    expect(withoutUntypedAddresses("Quit without notice.", "she quit")).toEqual({ text: "Quit without notice.", removed: [] });
  });

  it("Create reads the address from the manager's lines of a loop card's notes, never the card's own lines", () => {
    const card = draftNotesFromCard({ employeeName: "Remy Calder", employeeRole: null, locationName: "NE Kearney", formDate: "2026-11-14", issue: `Quit without notice. Home address ${ADDRESS}.`, warningLevel: null, payrollDeduct: null, priorActions: null });
    const notes = `${card.text}\n\nexit form for remy calder, she quit without notice`;
    expect(notes).toMatch(/Ashgrove/);
    expect(addressTypedIn(ADDRESS, notesWithoutCardLines(notes))).toBe(false);
    expect(addressTypedIn(ADDRESS, notesWithoutCardLines(`${card.text}\n\nher home address is ${ADDRESS}`))).toBe(true);
  });
});
