import { describe, expect, it } from "vitest";

import { payrollDeductFromConversation, payrollDeductReply } from "./payroll-deduct";

/**
 * A YES OR NO ANSWERS THE PAYROLL QUESTION ONLY WHEN IT WAS THE QUESTION ASKED
 * (QA, 25 Oct 2026). A bare "yes" was read as the payroll answer whenever the
 * last reply mentioned "payroll deduct" anywhere — the card's own
 * "**Payroll deduct:** No, as you said" line counted — so "yes" to "That date
 * is in the future — is 12-20-26 right?" set payroll deduct to Yes, flags off
 * too. Now the payroll question must be the last question that reply asked.
 */

/** A card in the sibling app's remap format for its conv_mvikc78w58v710y (synthetic name), with the future-date question after it. */
const CARD =
  "Here is the Corrective Action Form.\n**Employee:** sela brandt\n**Date:** 2026-12-20\n**Policy:** Attendance, as you said\n**Type of warning:** Written Warning, as you said\n**Payroll deduct:** No, as you said";
const FUTURE = "That date is in the future — is 12-20-26 right?";
const REQUEST = "create a written CA for sela brandt for not attending the monthly meeting on 12-20-26";

const turns = (assistant: string, reply: string) => [
  { role: "user", content: REQUEST },
  { role: "assistant", content: assistant },
  { role: "user", content: reply },
];

describe("a yes/no answers the payroll question only when that was the question asked", () => {
  it('"yes" to the future-date question does not set payroll deduct', () => {
    expect(payrollDeductFromConversation(turns(`${CARD}\n\n${FUTURE}`, "yes"))).toBeNull();
    expect(payrollDeductReply("yes", `${CARD}\n\n${FUTURE}`)).toBeNull();
  });

  it('"yes" after the card\'s own questions, none of them payroll, does not set it', () => {
    expect(payrollDeductFromConversation(turns(`${CARD}\n\nWhat is their job title?\nWhich store?`, "yes"))).toBeNull();
  });

  it('"yes" after a card that only reads the answer back does not set it', () => {
    expect(payrollDeductFromConversation(turns(CARD, "yes"))).toBeNull();
  });

  it("the payroll question asked last is still answered by yes or no", () => {
    expect(payrollDeductFromConversation(turns("Here is the Corrective Action Form.\n\nIs payroll deduct applicable?", "yes"))).toBe("yes");
    expect(payrollDeductFromConversation(turns("Here is the Corrective Action Form.\n\nVerbal or written?\nIs payroll deduct applicable?", "no"))).toBe("no");
    expect(payrollDeductReply("No.", "Is payroll deduct applicable?")).toBe("no");
  });

  it('the proposal flow\'s "Is payroll deduct applicable? Yes or No?" is still the question', () => {
    const asked =
      "I'll draft a **Corrective Action Form** for **Sela Brandt**.\n\nOne more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nCreate the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
    expect(payrollDeductFromConversation(turns(asked, "yes"))).toBe("yes");
  });

  it('"yes" after a reply that reads the answer back ("Is payroll deduct applicable? **No** — tell me if that should change.") does not set it', () => {
    const readBack =
      "I'll draft a **Corrective Action Form** for **Sela Brandt**.\n\nIs payroll deduct applicable? **No** — tell me if that should change.\n\nCreate the draft here when you're ready.";
    expect(payrollDeductFromConversation(turns(readBack, "yes"))).toBeNull();
    expect(payrollDeductFromConversation(turns(`${readBack}\n\n${FUTURE}`, "yes"))).toBeNull();
  });

  it("a numbered payroll item is still answered by its number", () => {
    expect(payrollDeductFromConversation(turns("1. Which date?\n2. Is payroll deduct applicable? (Yes or No)", "2. no"))).toBe("no");
  });
});
