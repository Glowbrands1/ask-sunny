# Loop-card Create: a missed shift is written up as an absence, not lateness (20 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and this applies only to Create from a loop card
(`fromAgentLoop` / `cardFromLoop`). Port it with the loop.

Background: QA's production audit (item 21), a real finalized form. Names in the cases are invented.

- The manager typed "did not come into her scheduled shift today at 9:30". The saved write-up said "Expectation: <P> is
  expected to arrive on time and be ready to work at the start of the scheduled shift". The Action Plan was the
  attendance plan: "… Continued lateness will result in further disciplinary review".
- The existing missed-shift reader (`MISSED_SHIFT` in `attendance-action-plan.ts`) misses "come into". It was not
  widened: no new word list reads the manager's messages.
- Fix, a record:
  - propose_form takes `attendance` ("absence" / "lateness" / "both") with `attendance_evidence`. These are the
    manager's quoted words from this request, and the card keeps the field only when the evidence checks out.
  - The card carries `attendanceKind`, and Create sends it as `cardAttendance`.
  - For "absence", the draft route keeps the general Action Plan (as a missed shift already does), not the
    attendance (lateness) plan.
  - `absence-write-up.ts` rewrites a drafted sentence that speaks of lateness. It reads the app's own drafted text,
    not the manager's words:
    - Under Expectation it becomes "<First> is expected to come in for every scheduled shift."
    - Under Going Forward it becomes "<First> will come in for every scheduled shift."
    - Anywhere else it is dropped; if Observed is left empty, it becomes the card's account.
- Not changed:
  - "lateness" and "both" cards.
  - Cards without the record.
  - The non-loop path.

## Required, never ignored (QA's review of #1137)

- A Corrective Action card that cites the manual's Attendance heading and has an account must carry `attendance`.
  This is decided from the card's own policy record, not from the manager's words; a word check on the account was
  not added.
- A missing value is refused with `attendance_not_given`.
- So is evidence whose quote is not in this request's manager messages: the existing normalized whole-word check
  refuses it with `attendance_evidence_not_found`.
- The refusal asks for the field, and the rules book says the same. Both codes are in `reason-codes.test.ts`.
- Replay cases:
  - the signed-warning shape with the field set;
  - the field omitted, where the tool asks;
  - a quote the manager never typed, which is refused.
