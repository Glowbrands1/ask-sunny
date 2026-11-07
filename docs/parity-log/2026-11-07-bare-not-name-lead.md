# This-app-only for now: the card's own employee leading a bare "not late" (BARE_NOT_NAME_LEAD_ENABLED)

Coding's bisect (7 Nov 2026): with REPLY_MATCHES_CARD on, "ca for <A> not late" lost "You haven't told me what happened yet". Rule 5 (`ai/reply-matches-card.ts`) asks BARE_NOT_DENIAL whether the card's account line only denies a fault, and "Observation of Offense: <A> not late" led with the employee's name, so it read as an account. With BARE_NOT_NAME_LEAD_ENABLED (default off), the card's own employee at the start of the Issue or account line is set aside before that check.

Not ported yet: the sibling app's rule 5 has no BARE_NOT_DENIAL check at all (this app's #596 was not ported there). Any Issue or account line counts as told there, so this fix has nothing to attach to. QA has the sibling app's "create a corrective action for <name>, not late" (no ask) as its own item. That item ports the denial check, and this one with it.
