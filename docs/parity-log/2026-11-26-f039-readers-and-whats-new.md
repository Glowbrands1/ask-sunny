# What's New, and the AI-readable pages readers (board f039 part 2): what reached Ask Bubbles

**Ask (Pau, 26 Nov 2026):** a What's New page with its reader, and readers for the `notReadable` pages (CLAUDE.md §5).

**Ported to Ask Bubbles** (one commit each, "Port from Ask Sunny (<sha>)"): the page registry itself
(`ai-readable-pages.ts` and its test, from 25bbe45, with Bubbles' own pages), What's New and `read_whats_new` (29a7c06,
with Bubbles' own entries and wording), and `read_ai_training` (ab72054; Bubbles has the same AI Training pages).

**Sunny-only, because Ask Bubbles has no such page:** Bed Usage, Spa Engagement and Spa Wellness (`read_stats`;
Bubbles' loop has no reports reader, and its `/reports/[reportId]` pages are its own), Videos (`read_videos`) and
Manager Resources (`read_manager_resources`). When Bubbles adds one of those pages, its registry test makes it declare
a reader, and these are the mechanisms to port.

**Not yet readable in either app:** Meetings / L10 (the Leadership Hub's docs), the Knowledge Base document list
(an admin console), and the admin and editor pages, which stay `notReadable` by design.
