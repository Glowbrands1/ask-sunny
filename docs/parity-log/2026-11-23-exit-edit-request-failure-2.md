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
- `propose_form` (Corrective Action): the exit form's on-file rule by person, form and incident date
  (`reason_code: "form_on_file_same_date"`): asked once, then the manager's answer decides; the same person's CA card on
  screen is a change to it.
- No word list: the forms' own levels, kinds, dates and the exit form's own date reader.

**Open (Pau's ruling):** HR's "remove dates for notice given and notice fulfilled" and "How Employee Resigned should
state …" on the revision are refused by the write layer (`would_blank` / `typed_by_manager`), because the live form's
fields were typed by the manager. Replay case `nov23-exit-hr-edits-revise-the-finalized-form` is `open` until the ruling.

**Ask Bubbles (main 72404b3):** the same level narrowing at `tools.ts` 2222/2233–2236 (it came with the #1259 port), the
same empty-value edit (`editForm` 6567), and the same exit form date (4957, 5724). Port the mechanism with Bubbles' own
form names and wording, through QA. Bubbles coder 5 is doing the repeat Corrective Action guard separately.
