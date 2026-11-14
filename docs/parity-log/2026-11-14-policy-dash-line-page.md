# POLICY_DASH_LINE_PAGE (Ask Bubbles #849): not needed in Ask Sunny

**Change in Ask Bubbles.** POLICY_DASH_LINE_PAGE_ENABLED (#849 re-land, on in Bubbles round 17z) gives a card's
"**Policy:** Standards of Conduct — <what>" line its printed page: "Standards of Conduct (JBA Policy Manual p.12) —
ringing up a sale inaccurately". On Bubbles' 17q card the page was nowhere on the card.

**Ask Sunny: not needed** (v2-QA, 14 Nov 2026). Sunny's card already cites the page on its own citation line, via
ONE_CARD_ONE_PAGE and CONDUCT_INCIDENT_CITES_PAGE (both on in production). Checked on main af04c58c with production
flags, through the real chat route (a replay probe, not committed). Every dash line is followed by
"Standards of Conduct Policy, JBA Policy Manual p.12":

| Request (pack's invented names) | Card's Policy line |
| --- | --- |
| "… for MSB" | **Policy:** Standards of Conduct — Must See Behaviors (MSB). … |
| "… his sales are low and he is not hitting his goals" | **Policy:** Standards of Conduct — sales performance against goals. … |
| "… for ringing up the wrong items on a guest's sale" | **Policy:** Standards of Conduct — ringing up a sale inaccurately. … |
| "… for missing the 10-15-26 woven deadline" | **Policy:** this reads as **Standards of Conduct** — a required deadline that was missed. … |
| "… not completing her woven courses by the deadline" | **Policy:** this reads as **Standards of Conduct** — assigned work that wasn't completed. … |

The lines are written in `src/lib/forms/ca-policy.ts` `caPolicyProposalLine` (Coding-2's file); nothing there changes.
