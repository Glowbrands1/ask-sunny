# 2026-11-20 — accents and curly apostrophes in names

**Needs port to Ask Bubbles: employee-match normalize/samePerson accents and ’** (Sunny commit 277279cff25f7ebde5d9a57f4b95eba087849fef). QA, 20 Nov
2026: kept in this repo only for now; ported after the Sunny batch lands.

`foldName` (`src/lib/forms/fold-name.ts`) drops accents without splitting the word and straightens every apostrophe. It
now backs the name check (`employee-match.ts` normalize) and `samePerson` (`proposal.ts`), both shared with Ask Bubbles,
and the loop's evidence reader and find_staff word reader (Sunny-only: Bubbles has no loop yet). The port is the
mechanism only.
