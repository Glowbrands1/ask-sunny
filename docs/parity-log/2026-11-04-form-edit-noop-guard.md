## 4 Nov 2026: no false "Updated" after a form edit, Step 4 — ported from Ask Bubbles (bdabffbe, #427) (FORM_EDIT_NOOP_GUARD_ENABLED, default off)

Port of the sibling app's Step 4, the mechanism in this app's setting. The one
writer (`form-write.ts`, `form-reducer.ts`) refuses, on the tool, patch,
revision and correction paths, an op that sets a field to the value it
already has (`same_value`; a correction only when nothing it states changes,
and never when the Action Plan follows it) and an op whose value holds the
manager's whole latest message of 3 words or more (`copies_message`, the
overnight scan's sf-s11). Both hand the turn off, all or nothing. On a turn
the edit tool was offered, the reply about the form comes only from the
saved diff (`form-noop-reply.ts`): one `Updated: <label>: <value>` line per
real change (value at most 80 characters, cut at a word; a checkbox by its
option labels; a clear as `(cleared)`), or exactly "I didn't change anything
on the form. Tell me which part to change and what it should say." The two
strings are byte for byte the sibling's. Needs
FORM_EDIT_SINGLE_WRITER_ENABLED. No UI, DB, prompt or protected-file change;
no new model call.

Where this app differs: its answering call streams through `messages.create`
(the tests' double streams events, as in the Step 3 tests); its Corrective
Action draft already ticks Tardiness/Leaving Early and leaves the Job Title
empty, and a Corrective Action takes only its date, payroll, level and prior
actions from chat — so the sibling's e2e "position the form already has"
correction becomes QA's own position turn handed off with nothing written
(the correction preset's `same_value` is pinned in `form-noop-guard.test.ts`),
and the tick e2e adds Absenteeism. This app's own Step 3 differences (the
failed main call handed to the chain; the open form's card not re-proposed
when the tool is offered) are kept. The flag-classification run is to follow
(`docs/flag-classification/FORM_EDIT_NOOP_GUARD_ENABLED.md`).
