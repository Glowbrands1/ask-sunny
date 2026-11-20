# 2026-11-20 — the whole-directory read is paged

**Needs port to Ask Bubbles (shared code).** `readDirectoryRoster` (`src/lib/forms/employee-roster.ts`) asked for
5,000 / 20,000 rows, but the service answers at most 1,000 per request, so past that the directory (terminated people
included) was cut short with no error; Sunny's loop then reported a terminated person as not on the staff list. Every read
there is now paged with the file's own `readAllPages`. The same file in Ask Bubbles has the same reads (the store-scoped
reads were ported as "same mechanism in both apps"); not checked there in this session. Mechanism only.
