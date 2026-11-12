import { afterEach, describe, expect, it } from "vitest";

import { pastedReviewStart, readWithoutPastedReview, withoutPastedReview } from "./pasted-review";

/*
 * PASTED_REVIEW_NOT_ACCOUNT_ENABLED. Pau's sf-s22 (Sunny production, 4 Nov 2026), the manager's words verbatim; the
 * people are invented (Corwen Pell). The replay cases `nov5-sf-s22-ca-not-coaching` and
 * `nov10-sf-s22-pasted-review-never-drafted` run the chat.
 */
const REVIEW =
  "Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. I do not see a date showing that Spa/EFT was signed by Corwen. Please make sure all coaching documents are signed and dated (mm/dd/yyyy format) before uploading.\n\n2. **Details – Observed:** Please reword this section to:\n   \n   For the month of October 2026, Corwen completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa%.\n\n3. **Policy Violated:** Please change this from **Under Performance** to **Standards of Conduct**, as the second bullet under that policy is lack of sales performance. You may need to manually add this bullet.";

afterEach(() => {
  delete process.env.PASTED_REVIEW_NOT_ACCOUNT_ENABLED;
});

describe("a pasted review", () => {
  it("is read only for the manager's words around it", () => {
    expect(withoutPastedReview(`Use this to make it: ${REVIEW}`)).toBe("Use this to make it");
    expect(withoutPastedReview(`Make this:${REVIEW}`)).toBe("Make this");
    // In the draft's notes, the turns after it are kept.
    expect(withoutPastedReview(`146 tans\n\nUse this to make it: ${REVIEW}\n\nIt needs to be a CA, not a coaching form`)).toBe(
      "146 tans\n\nUse this to make it\n\nIt needs to be a CA, not a coaching form",
    );
  });

  it("starts at two numbered \"**Heading:**\" items without the lead sentence", () => {
    const items = REVIEW.slice(REVIEW.indexOf("1. **"));
    const turn = `Use this: ${items}`;
    expect(turn.slice(pastedReviewStart(turn)).trim().startsWith("1. **Kit Coaching Document:**")).toBe(true);
    expect(withoutPastedReview(`Use this: ${items}`)).toBe("Use this");
  });

  it("leaves an account alone, a single numbered item included", () => {
    const account = "Wynne Sarrow - verbal\n146 tans\nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
    expect(withoutPastedReview(account)).toBe(account);
    expect(withoutPastedReview("1. **Late:** she clocked in at 9:20")).toBe("1. **Late:** she clocked in at 9:20");
  });

  it("is read only with the flag on", () => {
    const turn = `Use this to make it: ${REVIEW}`;
    expect(readWithoutPastedReview(turn)).toBe(turn);
    process.env.PASTED_REVIEW_NOT_ACCOUNT_ENABLED = "true";
    expect(readWithoutPastedReview(turn)).toBe("Use this to make it");
  });
});
