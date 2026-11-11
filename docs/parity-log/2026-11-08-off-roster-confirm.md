# Not flipped alone: OFF_ROSTER_CONFIRM_ENABLED ships with FORM_NAME_FROM_ROSTER (on in the sibling app's production)

QA's round-6 flag audit (8 Nov 2026): on in the sibling app's production, never set here. It fixes a bug that only
FORM_NAME_FROM_ROSTER creates: with the name flags a card's employee comes from the roster only, so a form for
somebody not in Woven asked "Who is this form for?" on every answer. FORM_NAME_FROM_ROSTER_ENABLED is off here, so the
bug does not happen in this app's production (every off-roster case in the replay pack holds with production's flags,
main 0ae7b2e).

It is one of FORM_NAME's six companions (`src/lib/config/form-name-companions.test.ts`, QA's ruling of 7 Nov 2026):
it ships in the same flip as FORM_NAME_FROM_ROSTER, never before it and never without it.
