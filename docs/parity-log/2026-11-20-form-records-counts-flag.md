# 2026-11-20 — chat FORMS ON FILE block: counts by code, archived drafts out (FORMS_ON_FILE_COUNTS_ENABLED)

**Ported to Ask Bubbles behind the same flag (see its pull request).** QA's f081 follow-up: the chat's FORMS ON FILE
block (`lib/forms/chat-form-records.ts`) left counting to the model. With `FORMS_ON_FILE_COUNTS_ENABLED` (default off), the
block ends with COUNTS built by `lib/forms/forms-on-file-counts.ts` (per person as filed, per form, per date with statuses,
and a total) for the model to copy; a period is read up to 1000 rows and counted over all of them (up to 100 listed); and
an archived draft is left out unless the question says "archived" (finalized forms count archived or not, marked). Port
the mechanism; Bubbles' store wording only.
