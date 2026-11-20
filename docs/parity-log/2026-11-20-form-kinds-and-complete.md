# 2026-11-20 — form kinds stay apart; a cut-off list is never called complete

**Sibling app: port needed for the shared reader (not checked in this session; Ask Bubbles was not attached).**

- `forms/chat-form-records.ts` (shared mechanism, used by the regular chat's FORMS ON FILE block and the AI tools): a
  FormKind may carry `excludeTemplateNameWords`; the Coaching kind excludes "follow", and `ofKind` drops those rows after
  the read, because the read matches template-name words as part of the name (`ilike`). If Ask Bubbles' copy has the same
  Coaching / Follow-Up Coaching kinds (or its own kinds where one name contains another's word), port `ofKind` and the
  exclusion with its own template names.
- Agent loop only (tools.ts; Bubbles has no loop yet): find_past_forms keeps Follow-Up Coaching apart from Coaching, and a
  period list is complete only when the database returned fewer rows than it asked for (never counted after the
  visibility filter). Port with the loop.
