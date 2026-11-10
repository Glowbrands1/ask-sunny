# Sunny-only: a card that names its employee is never asked "Which of them" (TWO_FORMS_CARD_NOT_ASKED_ENABLED)

QA's live check after round 4 (8 Nov 2026, conv ef902fec): "Coaching form for <A>. Also a CA for <B>." (both off the
roster) made the Coaching card for A, status ready, offered B's Corrective Action, and still asked "Which of them is
this **Coaching Form** for — **<A>** or **<B>**?" above the card. The replay pack's readers do not reach that reply
(tried with the intent reader taking A, B, both or none, as a salon director and as an admin, on main and on the
deploy's 144c26b5), so the fix is a guard on the final reply (`forms/card-not-asked.ts`, run from the chat route
after the person guard): a "Which of them is this **<the card's form>** for — …?" line that offers the card's own
employee is left out. Proven on the live reply itself (`forms/card-not-asked.test.ts`).

Not needed in the sibling app: there two forms in one message give one card per request, each from what was said
about its own person, and no offer (Ask-bubbles nov7-two-forms-each-person). The tester's wording, both people off
the roster, run through its replay pack with its production flags (8 Nov 2026) gives "**1. Coaching Form — <A>**" and
"**2. Corrective Action Form — <B>**" with no "Which of them" line; a guard case with that wording is added there
(nov8-two-forms-card-not-asked-ef902fec).
