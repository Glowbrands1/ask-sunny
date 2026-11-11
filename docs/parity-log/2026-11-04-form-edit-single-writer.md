## 4 Nov 2026: one writer for every form edit, Step 2a — ported from Ask Bubbles (117e33b1, #414) (FORM_EDIT_SINGLE_WRITER_ENABLED, default off)

Port of the sibling app's Step 2a, the mechanism in this app's setting. Every
unprotected path that edits an open draft hands its values to `writeFormEdits`
(`src/lib/forms/form-write.ts`), which runs them through the form reducer all
or nothing and saves through the existing writers: the chat correction
(`chat-correction.ts` form readers, the Corrective Action's header name and its
column, the moved dates, the CA facts, and this app's own payroll-amount save
after the amount question; `ca-chat-corrections.ts`), the redraft (the draft
route's write, its reduce gate, and its five stated-facts sites — this app's
are the two payroll-amount lines, the employment change facts, the exit facts
and the manager's Action Plan), the same-form copy, the policy change, the
reopen (snapshot and checked claim, plus this app's own restore of what a
"show … with edits" merge wiped), the Action Plan's sync and the patch turn.
New optional reducer rules: `drops_words`, the strict naming turn (owner's
Q2), `writein_without_box`, and the protected values (QA condition 2).

Where this app differs: there is no `relative-date.ts`; this app's correction
readers read a stated date with `datesInText`, so the correction preset uses
that reader. This app has no header-line correction function for the Coaching
Form (its name is not changed from chat). Its reopen declines a sentence that
names a Corrective Action, as on main, so a change in the same sentence is not
written there.

Not ported: the protected `chat-revision.ts` edit (2b) waits for the owner in
both apps.
