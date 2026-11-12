import { describe, expect, it } from "vitest";

import { REVIEW_NOT_ACCOUNT_NOTE, pastedCustomerReviewStart, withPastedReviewAsk } from "./pasted-customer-review";

// QA's Bubbles 17n live test (12 Nov 2026, item 2), QA's own wording (the name invented).
const SAID =
  "create a coaching form for Wynne Larkspur. Here is a customer review: 'Went in on Saturday and the girl at the counter ignored me for 10 minutes and was rude when I finally asked for help. One star.'";
const READY = {
  content:
    "Here is what I would put on a **Coaching Form**.\n\nEverything I need is here, drawn from your message above.\n\nI have **Wynne Larkspur** and the store. Create the draft here when you're ready.",
  formProposal: { templateKey: "coaching" },
};

describe("PASTED_REVIEW_ASKS_WHAT_YOU_SAW (the step itself; the route asks it only with the flag on)", () => {
  it("says the review is the customer's words and asks what the manager saw", () => {
    const out = withPastedReviewAsk(READY, SAID);
    expect(out.content).not.toMatch(/Everything I need is here/);
    expect(out.content).toContain(REVIEW_NOT_ACCOUNT_NOTE);
    expect(out.content).toMatch(/What did you see happen\?/);
    expect(out.content.startsWith("Here is what I would put on a **Coaching Form**.")).toBe(true);
    expect(out.formProposal).toBe(READY.formProposal);
  });

  it.each(["Google review: rude at the register", "I got a customer complaint - she was rude", "this yelp review: one star"])("reads %j as a pasted review", (text) => {
    expect(pastedCustomerReviewStart(text)).toBeGreaterThanOrEqual(0);
  });

  it("a manager who also says what happened is as before", () => {
    const own = "create a coaching form for Wynne Larkspur, she was rude to a customer at the counter on 11/7. Here is a customer review: 'One star.'";
    expect(withPastedReviewAsk(READY, own)).toBe(READY);
  });

  it("no review, or no card, is as before", () => {
    expect(withPastedReviewAsk(READY, "create a coaching form for Wynne Larkspur")).toBe(READY);
    const noCard = { content: "Which form?" };
    expect(withPastedReviewAsk(noCard, SAID)).toBe(noCard);
  });

  it("\"review the policy with her\" is no pasted review", () => {
    expect(pastedCustomerReviewStart("please review the policy with her: attendance")).toBe(-1);
  });
});
