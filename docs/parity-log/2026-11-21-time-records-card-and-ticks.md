# A Time Records card names the box the form ticks (21 Nov 2026)

**Sibling app: not needed now.** The changed line is the agent-loop card's policy line (`tools.ts`), and Ask Bubbles has
no agent loop yet. The shared reader change (`cardPolicyHeading`) only strips a "<box> — " prefix in front of a heading
listed in `READERS_LINE_HEADINGS`. Ask Bubbles' Type of Offense boxes and manual headings are its own company content,
so a port with its loop would list its own headings. This session cannot read the Ask Bubbles repository, so the check
is by mechanism, not by reading its code.

Background: Runner 2's c259 re-run on c2b17d2, from QA2.

- **What happened.** The loop card cited "Time Records Policy, JBA Policy Manual p.36". The saved form ticked
  standards_of_conduct and read "Standards of Conduct — Time Records".
- **Why.** The form has no Time Records box, and Pau was told Time Records is recorded under Standards of Conduct
  (QA f071, #1164).
- **Ruling (QA2, option (a)).** The card now says the same: "Standards of Conduct — Time Records, JBA Policy Manual
  p.36". The form keeps the tick and the line, and the Direct policy still quotes Time Records.
- **One place.** `readers-line-headings.ts` holds the heading-to-box map. The loop card, Create's reading of the heading
  back from the card, and the draft route's saved Policy Violated all read it. Pau's other options are a one-line change
  there:
  - (b) tick Other;
  - (c) write the card's own line to Policy Violated.
