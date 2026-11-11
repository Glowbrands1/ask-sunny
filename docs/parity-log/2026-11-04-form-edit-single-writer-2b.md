## 4 Nov 2026: one writer, Step 2b — ported from Ask Bubbles (44856eb0, #418) (FORM_EDIT_SINGLE_WRITER_ENABLED, default off)

Port of the sibling app's Step 2b, the mechanism in this app's setting. Still
without the protected `chat-revision.ts` hunk (pending the owner in both
apps), so the one-writer test still exempts the revision and the flag cannot
be flipped.

- Corrections keep unnamed words: the correction preset applies `drops_words`
  and the new reducer rule `droppedWordsReplaced` (each dropped word replaced
  one for one by an added word, a word containing it first: "doe" →
  "doe-smith"); on one-fact lines (the header and short text fields) a
  restated value need not name the old word. Words only, no phrase lists.
- The harness tests read the saved form: `src/test/forms/saved-form-instances.ts`
  keeps what each test's writer mocks save and returns it from `loadInstance`;
  nine `*.single-writer.test.ts` files re-run their file with the flag on. Two
  flag-on expectations read the outcome directly (a write that changes nothing
  calls no writer), each with a comment; no flag-off expectation changed.
- The post-draft check (detect and report only, +0 model calls, no retry):
  the account fields against the header's name and the dates and amounts the
  notes state; on a miss the notice says what was left out, and the trace
  records `slots.draft_check`. The drafting model can no longer write the
  header's `employee_name`.
- `statedWrite` keeps only the lines the form has, and the draft paths read a
  relative day the manager said.

Where this app differs: there is no `relative-date.ts`; the spoken-date reader
the draft route already writes a date line from is the exit reader's
(`exit-facts.ts`), now exported as `spokenDates` for `draftDates`. Its chat has
no Coaching Form header correction, and the Corrective Action's name is taken
from chat only as a roster-confirmed full name, so no chat wording here reaches
a header write that drops a word; the refusal is pinned at the writer. The
harness files differ (this app has no truncated-draft-route or
chat-correction-stress tests, and two more, woven-manual-citation and
woven-policy-draft).
