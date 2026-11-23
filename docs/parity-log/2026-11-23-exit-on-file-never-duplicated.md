# The live duplicate exit form: an exit card for a person with an exit form on file is not made; the exit card keeps how the person left — Ask Bubbles port through QA

**Report (QA, 23 Nov 2026; Pau's review of a live Sunny chat):** an Assistant Salon Director asked to edit <P>'s exit form
for HR. The reply said no exit form was on file, though a finalized one from 11/20 was. She said "make  an exit form
then", and <P> got a second exit form, with HR's edits on the new draft. "How did <P> leave …?" was then asked twice after
"effective immediately".

**Change (Ask Sunny):**
- `propose_form` for the exit form reads this person's exit forms on file that the manager can see (as find_past_forms
  reads them). With one on file, no card is made: `reason_code: "exit_on_file"`, the forms (status, date, salon), and an
  `ask_exactly` offering to open it (a revision; the filed form stays as it is) or start a new one. Asked once: when the
  previous reply holds the question (the app's own words, by the form's own name), the manager's answer decides. The same
  person's exit card already on screen is a change to it, never asked.
- The card record keeps the exit card's resignation type (`CardRecord.exitType`, an option key of the form). The same
  person's exit card proposed again with no type in the new request keeps it, so how they left is not asked again.
- No word list: the forms on file, the card record and the form's own option keys.

**Root cause in production (not settled here):** on main with production's flags, find_past_forms lists the finalized
exit form first. The production result was about half that size and the reply named only four Corrective Actions; the
exit and coaching forms an Assistant Salon Director reads only through `NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED`
were missing. Reported to QA to check that build-time flag in production.

**Ask Bubbles:** the same gaps on Bubbles main 72404b3 (no exit-on-file check in propose_form; no exit type on the card
record). Port the mechanism with Bubbles' own form names and wording, through QA.
