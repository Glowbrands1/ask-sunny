# Agent loop: coaching cards always cite a policy; clocking out early and staying late (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Pau's rulings via QA:

- **Coaching always has policy and page.** Coaching and Follow-Up Coaching cards always carry the manual heading that fits
  the card's own account, chosen as for a CA (`policy_not_given` now fires for them too). A heading copied from another
  form's card is refused (`policy_copied`), and "Other — <topic>" is used when no section fits. On Create, #1090's
  `cardPolicyLine` writes that line as the saved Coaching Form's last Details line ("Policy reference: <line>"). The
  replay cases `nov17-coaching-policy-on-saved-details-*` cover QA's live check (draft 3b1279b1 saved with no policy).
- **Clocking out early** or leaving before the end of the scheduled shift is Attendance. The closing detail stays in the
  account, since a card cites one heading.
- **Staying after hours,** or clocking out more than fifteen minutes after the shift without approval, is the manual's
  Time Records section. Production's manual already lists that heading (Timekeeping & Payroll, printed page 36), so it is
  among the allowed headings.

Port with the rest of the loop when Ask Bubbles gets it.
