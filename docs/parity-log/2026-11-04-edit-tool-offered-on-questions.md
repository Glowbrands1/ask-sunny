## 4 Nov 2026: edit_form offered on question turns too — ported from Ask Bubbles (899438b5, #427) (Pau's ruling A3, FORM_EDIT_TOOL_IN_STREAM_ENABLED)

Port of the sibling app's change for Pau's ruling A3. The `ABLE_TO_ACT`
reading ("is it possible / able to <action>") and the `asksToActAnyAction`
option that fed it (both ported here in #504) are removed from
`src/lib/ai/question-not-form.ts`: no phrase list or regex decides the offer.
With FORM_EDIT_TOOL_IN_STREAM_ENABLED on, `edit_form` is offered on any turn
with a draft form open, question-phrased turns included (the correction,
name-fix and policy-change exclusions stay). The question reading is kept in
the trace (`gate`) for information. A pure question answered in text keeps
that text as its reply; a tool call that writes nothing gets the no-op
guard's line (FORM_EDIT_NOOP_GUARD_ENABLED, ported just before). The 5
question-phrased edits still reach `edit_form`; the 3 negative controls (e2e
and replay pack) are rewritten the same way, each changed expectation citing
A3. Flag off unchanged.

This app's own Step 3 differences keep working and now cover question turns
as well: the intake's card for the form already open is not the turn's
answer when the tool is offered (`reproposesOpenForm` in `server-ask.ts`,
read off `formEditTool.offer`), and a failed main call is no offer (the
route's `.catch` → `turn.failed()`, recorded as `handoff: "error"`).
