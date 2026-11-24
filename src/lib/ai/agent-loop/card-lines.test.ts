import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EXIT_CARD_LABELS } from "./exit-read-back";
import { CARD_LINE_LABELS, cardLines, historyReply, withoutAppNotes, withoutCardLines } from "./card-lines";

/* Port of Ask Bubbles #1038 (its QA's live re-run 2, 22 Nov 2026, "saved ≠ card"); the person is invented. */
describe("card lines", () => {
  const faked =
    "Here's the updated Corrective Action Form for **Marisol**.\n\n**Observation of Offense:** Marisol did not wipe down the beds between guests.\n\n**Is payroll deduct applicable?** No, as you said.\n\nWarning level isn't set; tell me if it applies.\n\n[app note: this reply showed a card built with propose_form]";

  it("finds the card's own labelled lines, anywhere in the line, and not a bold word in a sentence", () => {
    expect(cardLines(faked).map((line) => line.label)).toEqual(["Observation of Offense", "Is payroll deduct applicable?"]);
    expect(cardLines("Noted — **Type of Warning:** Verbal Warning, as you said.").map((line) => line.label)).toEqual(["Type of Warning"]);
    expect(cardLines("The card already cites the **Policy** that fits: **Attendance Policy, JBA Policy Manual p.14**.")).toEqual([]);
  });

  it("leaves out the card lines and never shows an app note", () => {
    expect(withoutAppNotes(withoutCardLines(faked))).toBe("Here's the updated Corrective Action Form for **Marisol**.\n\nWarning level isn't set; tell me if it applies.");
  });

  it("shows an earlier card reply to the model as one stand-in line, with no note to copy", () => {
    const shown = historyReply(faked, "Corrective Action Form");
    /*
     * Changed on purpose (port of Ask Bubbles #1058, its QA's live round 3, U21 T10–T12): the stand-in line now says what the
     * card held, as data ('Observation of Offense = "…"'), because without it the model rebuilt the card from one field and
     * lost the rest. It is still never a card line to imitate: no bold label, no "as you said", no app note.
     */
    expect(shown).not.toMatch(/app note|\*\*Observation of Offense|as you said/);
    expect(cardLines(shown)).toEqual([]);
    expect(shown).toMatch(/\[card shown under this reply: Corrective Action Form, made by propose_form[^\]]*; it held: [^\]]*Observation of Offense = "Marisol did not wipe down the beds between guests\."; Is payroll deduct applicable\? = "No"/);
  });

  it("the history's bracketed card line, copied into a reply, is never shown (port of Ask Bubbles #1058)", () => {
    const copied = "Updated the card.\n\n[card shown under this reply: Corrective Action Form, made by propose_form; the card itself is on the manager's screen; it held: Type of Warning = \"Verbal\"]";
    expect(withoutAppNotes(copied)).toBe("Updated the card.");
  });

  /* Changed on purpose (22 Nov 2026, the exit labels joined CARD_LINE_LABELS, as in Ask Bubbles): the exit form's own labels come from `exit-read-back.ts`, not the rules book, so only the Corrective Action labels are checked against it. */
  it("every card label is one the rules book tells the model to write, or the exit form's own", () => {
    const book = readFileSync(new URL("./rules-book.ts", import.meta.url), "utf8");
    for (const label of CARD_LINE_LABELS.filter((label) => !EXIT_CARD_LABELS.includes(label))) expect(book, label).toContain(`**${label}`);
  });

  it("an exit card's own labelled line is a card line too", () => {
    const label = EXIT_CARD_LABELS[0]!;
    expect(cardLines(`Noted.\n\n**${label}:** 11/14/2026`).map((line) => line.label)).toEqual([label]);
    expect(withoutCardLines(`Noted.\n\n**${label}:** 11/14/2026`)).toBe("Noted.");
  });
});
