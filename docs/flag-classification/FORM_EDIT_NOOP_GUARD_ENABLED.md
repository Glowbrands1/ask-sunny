# FORM_EDIT_NOOP_GUARD_ENABLED: which tests it changes, and why

Ported from Ask Bubbles (bdabffbe, #427). **The Sunny classification is to
follow**: the full run of `node scripts/flag-classify.ts` (3 runs off, 3 on,
the whole suite; on in both: `FORM_EDIT_SINGLE_WRITER_ENABLED`,
`FORM_EDIT_TOOL_IN_STREAM_ENABLED`) was not made with this port, because the
machine it was built on was overloaded. Until it is,
`FORM_EDIT_NOOP_GUARD_ENABLED.classes.json` is empty (`{}`) and the flag stays
off in production.

Ask Bubbles' own classification of the same change (15899 tests, 51 changed,
all INTENDED) is in that repository's
`docs/flag-classification/FORM_EDIT_NOOP_GUARD_ENABLED.md`.

What this port checked instead, with the flag's own tests:

- `src/app/api/chat/form-edit-noop-guard-flags-off.test.ts`: flag off (with
  the tool flags on, and production's flags alone) and the guard alone (no
  single writer) are byte for byte Ask Sunny's main before the flag
  (7cd59a77), recorded in `form-edit-noop-guard-flags-off.main.json` before
  the change; the guard on differs.
- `src/app/api/chat/form-edit-noop-guard-e2e.test.ts`,
  `src/lib/forms/form-noop-guard.test.ts`, and the replay pack's
  `nov4-noop-guard-cases.ts`.
