# 2026-11-21 — a period list stops at the last whole day

**Agent loop only. Sunny-only for now. Log it for the loop port (Coding-D copies from Sunny main).** Ask Bubbles' agent
loop isn't live. Production "list ca for the month" (QA2, 21 Nov 2026) replied "100 of 121 shown" but wrote 102 rows.
find_past_forms' period list cut at 100 rows, and that cut fell inside 11/03 (37 of its 39 listed). The model then wrote
11/03 from `counts.by_date`, which has all 39. The list now stops at the end of the last whole day that fits under 100.
The days after the cut come back as `not_listed_days` (date and count only), and the note gives the exact number shown.
If a single day has more than 100 forms, that day is still cut at 100.

**Follow-up for both apps:** the older chat path's FORMS ON FILE block (`lib/forms/chat-form-records.ts`, with counts
behind FORMS_ON_FILE_COUNTS_ENABLED, #1182 and Ask-bubbles #981) also cuts at 100 rows (`NARROWED_LIMIT`). The same
whole-day rule applies there before that flag is turned on.
