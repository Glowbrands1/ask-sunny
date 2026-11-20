import { describe, expect, it } from "vitest";

import { withFullOffRosterName } from "./off-roster-line";

/* QA's f070 (20 Nov 2026): the live reply named the off-roster person by first name only in the not-on-the-staff-list line. */
describe("the not-on-the-staff-list line keeps the full name (f070)", () => {
  it("puts the full name back where the reply used the short name", () => {
    const reply = "Here's the Corrective Action Form for **Arlo**. Arlo isn't on the Woven staff list, so I've used the name as you typed it. Check the spelling before you press Create.";
    expect(withFullOffRosterName(reply, "Arlo Quillfeather", "Woven")).toBe(
      "Here's the Corrective Action Form for **Arlo**. **Arlo Quillfeather** isn't on the Woven staff list, so I've used the name as you typed it. Check the spelling before you press Create.",
    );
  });

  it("the salon wording, and a bold short name, are fixed too", () => {
    expect(withFullOffRosterName("**Arlo** isn't on your salon's Woven staff list, so I've used the name as you typed it.", "Arlo Quillfeather", "Woven")).toBe(
      "**Arlo Quillfeather** isn't on your salon's Woven staff list, so I've used the name as you typed it.",
    );
  });

  it("leaves a reply that already names the full name in bold, or has no such line, as it is", () => {
    const right = "Here's the form for **Arlo**. **Arlo Quillfeather** isn't on the Woven staff list, so I've used the name as you typed it.";
    expect(withFullOffRosterName(right, "Arlo Quillfeather", "Woven")).toBe(right);
    const other = "Here's the Corrective Action Form for **Arlo**. Arlo was late on 11/20.";
    expect(withFullOffRosterName(other, "Arlo Quillfeather", "Woven")).toBe(other);
  });
});
