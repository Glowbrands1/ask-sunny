# Board f039: the pages the AI can read — Ask Bubbles port later, through QA

**Ask (QA, 23 Nov 2026, for Pau's "how can we program this AI to read new things added to the app? i need to always say
it?"):** a central page list, so a new page or report is readable by the AI, or says why not, before it can merge
(CLAUDE.md §5).

**Change (Ask Sunny):** `src/config/ai-readable-pages.ts` has one entry per page under `src/app/(app)` (and
`/api/partner/hub-reviews`, report figures with no page): its gate, and the loop tool that reads it (args, figures,
periods, replay case) or `notReadable` with why. `ai-readable-pages.test.ts` fails on a page with no entry, a gate that is
not the page's own, a reader that checks another permission than the page (`READER_PERMISSION`, which the handlers
use), a tool that doesn't exist, or a replay case that isn't in the pack. The data tools' descriptions and the rules
book's Business data line are written from it (`AppConfig.readablePages`), so the prompt fixtures change only when the
list does.

**Ask Bubbles:** same loop, data tools and rules book. Port the mechanism (the types, the generated lines, the test)
with Bubbles' OWN list, written from its own pages; never Sunny's list, titles or routes. Later, through QA.
