# 2026-11-20 — a loop card's policy line is the saved Policy Violated

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet, and this runs only for a card from the loop
(`cardFromLoop`, the draft route's `loopCardHeading`).

QA's live test (f071): a card citing "Late Opening Policy, JBA Policy Manual p.15" saved Policy Violated "Attendance
Policy — Late Opening". The 18 Nov fix wrote the card's line into Policy Violated only when a Type of Offense label named
the heading (Dress Code). It is now written for every heading, and the Type of Offense tick is left as the readers set
it. The headings in `READERS_LINE_HEADINGS` keep the readers' "<box> — <section>"; that is Time Records ("Standards of
Conduct — Time Records"), as Pau was last told. Port with the loop, using Bubbles' own manual headings.
