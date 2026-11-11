# 6 Nov 2026: the whole typed position on an exit form — the sibling app's FULL_POSITION_TITLE_ENABLED; not needed here

QA task A: in the sibling app, an exit form typed as lines with a position
whose name holds a shorter title of its list ("<title> Part Time") got the
shorter title as the card's Position. The sibling app fixes it behind
FULL_POSITION_TITLE_ENABLED (default off): when the whole typed title is one of
its company's position names (`staff-picker.ts`, `isCompanyPositionTitle`),
the card keeps it whole.

**Not ported: this app does not cut its positions.** Checked through the real
chat route with production's flags, an exit form typed as lines
("<name>\n<position> \nNE Kearney\nGave notice …"):

- "Assistant Salon Director" is read as "ASD" (the title list's most specific
  match, before "Salon Director") and spelled back out by
  TITLE_SPELLED_OUT_ENABLED, on in production: the card says "Assistant Salon
  Director".
- "Salon Director" and "Tanning Consultant" are whole titles of the list.
- No salon position in `staff-picker.ts` holds a shorter title of the list
  that the reader would stop at, so there is nothing for the flag to change
  (QA's rule: no flag that changes nothing).

Guard cases instead, in `src/app/api/chat/replay-pack/nov6-coding3-full-position-title-cases.ts`
(status fixed): `nov6-coding3-full-position-title-asd-exit`,
`nov6-coding3-full-position-title-sd-exit`, and the negative
`nov6-coding3-full-position-title-negative` ("Tanning Consultant Weekends
Only" stays "Tanning Consultant"). If a longer salon position is added to the
directory, these are where the gap shows; port the mechanism then.
