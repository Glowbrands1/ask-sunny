# 2026-11-20 — forms on file are counted by code; archived only when asked (f081)

**Agent loop: Sunny-only for now.** Ask Bubbles has no agent loop. find_past_forms (both the per-person and the period
list) now returns `counts` built by `lib/forms/forms-on-file-counts.ts`: per person (the name as filed, never merged with a
different name), per form, per date with statuses, and a total; the rules book tells the model to copy them. Archived drafts
are left out unless `include_archived` (QA: finalized forms count whether or not archived, marked archived); the period is read up to 1000 rows and
counted over all of them, with up to 100 listed and "N of M" said.

**Follow-up for both apps:** the older chat path's FORMS ON FILE block (`lib/forms/chat-form-records.ts`, shared with Ask
Bubbles) still lets the model count rows and includes archived forms in a period list on purpose ("who got a CA this
month" asked what was filed). Changing it is a chat-wide change behind a flag, and a port; it is not in this pull request.
