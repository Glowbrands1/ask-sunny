# Failure 2: HR's edit request for an exit form finds the form; a level named never drops other kinds; exit date lines are not the form date; a repeat Corrective Action on the same incident date is asked about — Ask Bubbles port through QA

**Report (QA, 23 Nov 2026; Pau's review of a live Sunny chat, which extends #1294):** an Assistant Salon Director pasted
HR's edit request for <P>'s exit form ("… gave verbal notice of her immediate resignation …"). The reply said no exit form
was on file and listed four Corrective Actions. "make an exit form then" made a second exit draft dated 11/17 (the last
day worked) with HR's edits, and "How did <P> leave …?" was asked twice.

**Root cause (found):** `find_past_forms` narrows by a warning level the manager names (U16, "put up the verbal CA"). It
read the whole message, so "verbal notice" in HR's text kept the Verbal-level Corrective Actions and dropped every other
form: the finalized exit form and the coaching form. The earlier repro missed it because its seeded CAs had no level.

**Change (Ask Sunny):**
- `find_past_forms`: a named level only chooses among Corrective Actions; a form of another kind never has a level, so it
  is never dropped by one.
- `edit_form`: an empty value the model sends is a field to clear, passed to the writers' own clear list (their rules
  decide what may be cleared).
- `propose_form` (exit form): a date the manager's words give to one of the form's own date lines (last day worked,
  notice given, notice fulfilled; `readExitFacts`) is that line's date, never the form's.
- `propose_form` (Corrective Action and Coaching Form): the sibling app's same-incident mechanism and names (Bubbles
  coder 5's `fix/same-incident-form-on-file`): a form of this kind for this person already on file for the card's
  incident date makes no card; `reason_code: "same_incident_on_file"`, ask_exactly "<P> already has a Corrective Action
  for <date> (<status>). Do you want to open that one, or is this a separate incident?", and a `same_incident` trace record
  so the next turn's request starts at the question. The manager's "separate incident" (separate_incident_evidence)
  makes the card.
- `edit_form` (Pau, 24 Nov brief, item 4; QA's ruling): `clear_evidence` per field, and a value whose text is in this
  message, are saved as the manager's own edit (drafts only); `stated_edits` names each field for the reply.
- No word list: the forms' own levels, kinds, dates and the exit form's own date reader.

**Item 4 (Pau's ruling, 23 Nov 2026):** HR's "remove dates for notice given and notice fulfilled" and "How Employee
Resigned should state …" now apply on the revision; a field the message does not name keeps the manager's typing (control
case `nov23-exit-edit-control-unnamed-field-untouched`).

**Ask Bubbles (main 72404b3):** the same level narrowing at `tools.ts` 2222/2233–2236 (it came with the #1259 port), the
same empty-value edit (`editForm` 6567), and the same exit form date (4957, 5724). Port the mechanism with Bubbles' own
form names and wording, through QA. Bubbles coder 5 has the same-incident guard (Sunny matches its names); `clear_evidence` / `stated_edits` are for them to match.
