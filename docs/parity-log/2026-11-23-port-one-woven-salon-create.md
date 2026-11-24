# Create never saves a form with no salon while the card asks which salon; one Woven salon is the card's (port of Ask Bubbles #1072, board f140) — ported

**Report (Ask Bubbles, its QA's round 2, R01/R19/U05–U07, U26):** the card asked "Which store?" (or, for an admin,
filed no store) and Create saved the draft with NO store, for a person Woven lists at one of the manager's stores; a
former employee's card only offered their store.

**Ask Sunny, checked on main (daa2b3c):**
- **Create on a card still asking which salon: same bug.** `createInlineForm` posted `locationId` null for a card whose
  salon was still open (`needs_selection` / `needs_location`), and the server saved it. The regular (non-loop) chat's
  cards go through the same function, so the old chat's Create had the same gap (QA asked to check it): both are fixed
  by the one guard.
- **A former employee at one Woven salon: same bug.** The card only offered the salon (employee_salon).
- **A salon manager's or an admin's card for a person at one Woven salon with no Woven primary:** Sunny main already
  filed those at the salon (its proposal path reads the person's salons); the replay cases are kept as guards, and the
  ported `wovenSalonsOf` reading is in the same two places so the apps stay alike.

**Port (the mechanism, Sunny's salons):** `wovenSalonsOf` (Woven's primary first, then the roster's salons); exactly one
among the login's salons is the card's salon (salon_from_woven), for a salon manager, an admin (no new question) and a
former employee; several still ask. Create on a card still asking refuses before any request, with "Which salon is
this about? Choose the salon on the card, then press Create." and saves nothing. The pack's `create(salon?)` picks a
salon as the browser's picker does.

**Tests:** replay `nov23-agent-loop-one-woven-salon-cases.ts` (the former employee and the two-salon control fail on
main, the salon-manager and admin guards pass on both); unit `create-inline-form.test.ts` (f140 block: both open
shapes refused with no request, two controls).
