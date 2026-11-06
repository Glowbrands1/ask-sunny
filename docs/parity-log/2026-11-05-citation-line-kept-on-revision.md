# 5 Nov 2026: a chat edit keeps the app's citation line instead of being refused — Sunny-only for now

QA's production-flags read and bisect: with POLICY_CITATION_ENABLED on in this
app's production, the draft appends "Policy reference: …, JBA Policy Manual
p.N" to a Coaching draft's Details. A chat edit whose revision did not repeat
that line was refused (keepsSubstance missed its page numbers), so "fix her
last name, it is Laine" changed nothing. CITATION_LINE_KEPT_ON_REVISION_ENABLED
(default off) re-attaches the app's own trailing line on a wording or additive
revision (`src/lib/forms/app-citation-line.ts`, `planRevision` in
`src/lib/forms/revision.ts`).

**Not ported yet:** POLICY_CITATION_ENABLED is not set in the sibling app's
production, so its drafts carry no such line and its edits are not refused this
way. Port the mechanism if that flag is turned on there.
