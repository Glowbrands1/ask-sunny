import { describe, expect, it } from "vitest";

import { fullNameUsed, personPronoun } from "./reply-checks";

/* QA (16 Nov 2026): the live cases' pronoun check catches pronouns for the person, not "them" for the blank fields. */
describe("personPronoun", () => {
  const names = ["Rowan", "Rowan Kestrel"];
  it("passes 'them' for the fields (must-pass, from the live run)", () => {
    expect(personPronoun("Here's the Resignation/Exit Form for Rowan. Rehire and the reason aren't set; tell me and I'll add them, or fill them on the draft.", names)).toBeNull();
    expect(personPronoun("Rowan's last day worked: November 28, 2026. Two fields are blank: tell me and I'll add them.", names)).toBeNull();
  });
  it("fails a pronoun for the person (must-fail)", () => {
    expect(personPronoun("Here's the form for Rowan. Their last day was November 28.", names)).not.toBeNull();
    expect(personPronoun("I've got Rowan. Tell them the form is ready.", names)).not.toBeNull();
    expect(personPronoun("Do you want the Resignation/Exit Form for her, or a Corrective Action?", names)).not.toBeNull();
    expect(personPronoun("Rowan resigned and his last day is 11/28.", names)).not.toBeNull();
  });
  it("passes a reply with the first name and no pronoun", () => {
    expect(personPronoun("Here's the Resignation/Exit Form for Rowan. Rowan's last day worked: November 28, 2026. Filed as a resignation from your wording; say if it was a termination.", names)).toBeNull();
  });
});

describe("fullNameUsed", () => {
  it("flags the full name in the reply's words, bold or not", () => {
    expect(fullNameUsed("Here's the form for **Rowan Kestrel**.", "Rowan Kestrel")).not.toBeNull();
    expect(fullNameUsed("Here's the form for Rowan.", "Rowan Kestrel")).toBeNull();
  });
});
