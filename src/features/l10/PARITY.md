# DM L10 tab ↔ Leadership Hub: parity audit

Audited on 13 Nov 2026 against Leadership Hub `main` (`1487887`) and the Hub branch `claude/blissful-wozniak-fa6337`.
The Hub is the source of truth. Ask Sunny stores no meeting data: every read and write goes to the Hub's own record
through the partner API (`POST /api/partner/l10`), which runs as the person's Hub account. The Hub's database
checks the allowlist (`ask-sunny` → `stc-dm`) and the person's meeting role every time.

**How to re-run the file audit.** Every copied file starts with `// Copied from the Leadership Hub (<path>)`. Diff
it against that path, ignoring import prefixes. On this date, 29 files differ only by that header line. The rest differ
only as listed in "Copied files that differ" below.

## Features

| Hub feature | In Ask Sunny | How, or why not | Proof (tests) |
| --- | --- | --- | --- |
| Meeting page: agenda, sections, timers, round-robin, Business Best, Scorecard, Rocks, Headlines, To-dos, IDS, Conclude, Business Plan, Accountability Chart, Park it, Add to IDS | ✅ same | Copied page code, on the Hub's record | `meeting/meeting-view.dom.test.tsx` |
| Save: version-checked; a stale save is merged item by item; "All changes saved" only after the Hub confirms; a failed save shows the reason and Try again | ✅ same | The Hub's `useMeetingSync`; the Hub's save functions | UI: `meeting-view.dom.test.tsx` ("saving: …", 3 tests). End to end: Hub `src/lib/partner/partner.e2e.pg.test.ts` (real handler + real migrations in Postgres) |
| Live sync both ways (polling every 4 s, on focus) | ✅ same | Same record, same polling | `meeting-view.dom.test.tsx`; Hub e2e "an edit made in the Hub shows up…" |
| End meeting → recap | ✅ same | The Hub's `l10_end_meeting` body | Hub e2e "End meeting from Ask Sunny saves the recap…" |
| History: list, view a version, what changed | ✅ same | Hub history functions | `l10-routes.test.ts` |
| History: **Restore a version** | ✅ same rule: Hub admins only | Hub op `restore-version` mirrors the Hub's `restoreVersionAction` step for step: an admin check, then a normal version-checked save of the old document. A restore therefore always adds a NEW version and keeps the live clock | `meeting/admin-files.dom.test.tsx`, `admin-files.test.ts`; Hub e2e "Restore a version is for hub admins only…" |
| Recaps page | ✅ at `/meetings/stc-dm/recaps` (the Hub's `?meeting=stc-dm` view) | Hub `l10_partner_list_recaps` | `admin-files.dom.test.tsx` |
| Recaps: **Delete** | ✅ same rule: Hub admins only | `l10_partner_delete_recap` → the Hub's own `_delete_recap_as` (the hub_admin check is in the DB) | Hub `supabase/tests/l10_partner_admin_test.sql`; Sunny `admin-files*.test.*` |
| Recaps: **Restore a deleted recap** | ⚪ no button, as in the Hub | The Hub has the DB function (`l10_restore_recap`) but no UI for it. The partner op exists (`restore-recap`, admin only, tested), so a button can be added in both apps together | Hub `l10_partner_admin_test.sql` |
| Export PDF (report) | ✅ same | Copied report page | `l10-routes.test.ts` |
| **Files on an issue** (attach, open, unlist) | ✅ same rules | See "Issue files" below | Hub `partner.test.ts` ("partner issue files…", "the partner Storage client…", guard test); Sunny `admin-files.test.ts`, `admin-files.dom.test.tsx` |
| Bell: notifications, unread count, mark read | ✅ same rows | Hub notification functions, own rows only | `notifications/*` tests |
| Notification settings | 🔗 link to the Hub | Settings belong to the Hub account, not to a meeting | — |
| Reference: Business Plan, Accountability Chart | ❌ none for the STC DM L10 (its leader asked, 13 Nov 2026), in both apps | No Reference block. A `?view=` link to either view is a 404, and a leader's shared reference view is not followed. The report has no Business Plan or Organizational Chart pages. The Hub's assistant refuses those parts for stc-dm. The Hub's database leaves `vto` / `seats` out of every stc-dm read and keeps the stored ones on save (hidden, never deleted). The Hub's roster sends `reference: false` | `meeting-view.dom.test.tsx`, `l10-routes.test.ts`, `l10-access.test.ts`; Hub `l10_stc_dm_reference_test.sql` |
| Accent colour | ❌ differs on purpose (the owner's request, 15 Nov 2026) | The Hub's gold and bronze become Ask Sunny's brand yellow (the rail's active pill) by re-pointing the accent tokens inside `.hub-l10` in `src/app/globals.css`; no component changes. Yellow is a fill with dark text, amber (`--approved-yellow-label`) is the text and outline colour. Ask Bubbles does the same with its teal (Ask Bubbles #941) | `l10-accent.test.ts` |
| Rock Review: "Add new rock" form at the TOP, under the section title (owner's request, 13 Nov 2026) | ✅ same | The same change in both apps' `Rocks.tsx`, for every meeting; behaviour unchanged | `meeting/_components/Rocks.order.dom.test.tsx`; Hub `Rocks.order.test.tsx` |
| Rock Review: a rock opens in a **right-side panel** laid out like Bloom Growth's goal drawer (about half the screen, no overlay; due date and a tinted status, title, details, milestones, owner with initials, Duplicate; Archive and Delete in the footer with the save status; it autosaves), the list stays on the left; one rock at a time; close ✕ or Esc; a full-width sheet on a phone (QA, 15 Nov 2026) | ✅ same | The same `RockRow` + `RockPanel` in both apps' `Rocks.tsx`, on the same save path. The floating Add to IDS and assistant buttons move left of the panel (`[data-side-panel]` in `globals.css`, scoped to `.hub-l10` here) and step aside on a phone | `meeting-view.dom.test.tsx` ("Rock Review: a rock opens in a side panel"); Hub `MeetingSections.test.tsx` ("rock review side panel") |
| Recap **notes**: the meeting's shared notes (`doc.meetingNotes`) are saved on its recap and shown on the recaps and Past meetings pages (15 Nov 2026) | ✅ same | `buildRecap` carries them; the partner `end` op passes them to the Hub's `l10_partner_end_meeting(…, p_notes)` (Hub migration `20261205120000_l10_recap_notes.sql`). Sent only when there are notes | `l10-access.test.ts`, `lib/past.test.ts`; Hub `l10_recap_notes_test.sql`, `partner.e2e.pg.test.ts` |
| Bloom-style pages, part (a): Meeting Notes drawer under the agenda (`doc.meetingNotes`), "Last meeting's summary" on top (collapsed; newest recap or Bloom import), New Issue bar at the bottom with an owner (in place of Add to IDS) (the owner's request, 15 Nov 2026) | ✅ same | The Hub's `BloomShell.tsx` and `lib/bloom.ts`, copied. `bloomStyle` is the STC DM L10 here (the Hub also lists its BCS DM L10). The page loads recaps through the partner `list-recaps` op | `meeting-view.dom.test.tsx` ("Bloom-style page: what every page shares"); Hub `BloomShell.test.tsx` |
| Bloom-style pages, part (b): Segue has "Last week's feedback" and "This week's question" (`doc.segueQuestion`) above the round-robin; Conclude before the meeting starts shows the last meeting's summary (stats, FEEDBACK, TO-DOS by owner, ISSUES SOLVED, NOTES) (the owner's request, 15 Nov 2026) | ✅ same | The Hub's `BloomSections.tsx`, copied | `meeting-view.dom.test.tsx` ("Bloom-style page: Segue and Conclude"); Hub `BloomSections.test.tsx` |
| Recap **notes**: the meeting's shared notes (`doc.meetingNotes`) are saved on its recap and shown on the recaps and Past meetings pages (15 Nov 2026) | ✅ same | `buildRecap` carries them; the partner `end` op passes them to the Hub's `l10_partner_end_meeting(…, p_notes)` (Hub migration `20261205120000_l10_recap_notes.sql`). Sent only when there are notes | `l10-access.test.ts`, `lib/past.test.ts`; Hub `l10_recap_notes_test.sql`, `partner.e2e.pg.test.ts` |
| IDS: "Long-term" / "Short term" button on every open issue row (next to Solve), and "Convert to: Headline" only where the agenda has Headlines (15 Nov 2026) | ✅ same | The same change in both apps' `Ids.tsx`. The row button uses `withTerm`, like the button in the opened issue; solved rows have none. Headline follows the agenda (the Hub's `agendaFor`; here the Hub-served agenda), so it is gone for the STC DM and Leadership L10s | `meeting/meeting-view.dom.test.tsx`; Hub `MeetingSections.test.tsx` |
| STC DM L10 agenda = its Bloom Growth agenda (the owner's request, 15 Nov 2026): AI Best Practice 5, Scorecard 10, Rock Review 8, To-do List 5, IDS 25, Conclude 5; the cadence line shows the agenda's total ("Tuesdays · 58 min") | ✅ same | Served by the Hub with the roster (`agendaFor`); this copy's `agendaFor("stc-dm")` is the fallback. `cadenceLabel` sums the agenda the page runs | `meeting/meeting-view.dom.test.tsx`; Hub `agenda.test.ts` |
| **Tracker** | 🔗 stays in the Hub | In the Hub, only Leadership L10 members and hub admins can open the Tracker. DM L10 attendees are not on that list, so showing it here would widen access | — |
| Assistant: system prompt, models, Deep think | ✅ same | Served by the Hub (`assistant-config`); runs on Ask Sunny's own `ANTHROPIC_API_KEY` | `assistant` tests |
| Assistant: meeting tools (`getMeeting`, `getMeetingRecaps`) | ✅ same | Executed by the Hub for this person | `assistant` tests; Hub `partner.test.ts` |
| Assistant: **note cards** → Hub bell | ✅ same | The Hub's `draftNote` tool and `send_note` body (meeting members only, hourly limit) | `assistant/note-card.dom.test.tsx`; Hub e2e "a note sent from Ask Sunny's card reaches the person's bell" |
| Assistant: **chat history** | ✅ same behaviour, own storage | The Hub's `storage.ts`, keyed `l10-hub-assistant:<Sunny user id>:<meeting>`, with the Hub's size cap. Attachments are dropped and every storage call is guarded. **Not shared with the Hub's history**: it lives in each app's own browser storage | `assistant/storage.dom.test.ts`, `assistant/panel-history.dom.test.tsx` |
| Assistant: tool chips, citations / sources, source viewer, Markdown | ✅ same | Copied `citations.ts`, `SourceViewer.tsx`, the same Markdown setup | `panel-history.dom.test.tsx` |
| Assistant: **@-mention picker** | ✅ same picker, this meeting's people | The Hub's `MentionPicker` + `chat-mentions`. People come from the Hub for this meeting only (the Hub offers everyone the person shares any meeting with) | `assistant/mention-picker.dom.test.tsx`, `admin-files.test.ts` |
| Assistant: attachments (images / PDFs) | ✅ same (owner decided 13 Nov 2026) | Ported from the Hub's `attachments.ts` (`attachmentProblem`, `toDataUrl`, `normalizedImage`: JPEG on white, ≤ 2000 px, ~1.5 MB) without the assistant-ui adapter: useChat sends them as AI SDK file parts. Attach button, paste and drop, chips with Remove, the Hub's words. Limits come from the Hub's config: 5 files, 10 MB each, PNG/JPG/GIF/WebP/PDF. The server repeats the Hub route's `attachmentProblem` (413, nothing logged), and `convertToModelMessages` passes the files to the model, which reads PDFs natively. Saved chats keep the file name and drop the bytes, as in the Hub. A reopened chat sends a short note in place of a dropped file (in the Hub, such a chat is refused with "Attachments must be uploaded from your device"; reported to QA) | `assistant/attachments.dom.test.tsx`, `assistant-attachments-web.test.ts` |
| Assistant: web search / web fetch | ✅ same (owner decided 13 Nov 2026) | Anthropic's `web_search` (5 uses) and `web_fetch` (3 uses, citations on), with the limits from the Hub's config. Results and cited pages come back as sources and show as pills under the answer (`sendSources`, the Hub's `collectCitations`). **One difference:** the Hub runs `webSearch_20260318` / `webFetch_20260318` on `@ai-sdk/anthropic` 4.x (AI SDK 7). The newest `@ai-sdk/anthropic` for AI SDK 6 (3.0.142, npm tag `ai-v6`; Ask Sunny pins 3.0.138) only has `webSearch_20260209` / `webFetch_20260209`, so Ask Sunny runs those and no package was upgraded. The options the Hub uses (`maxUses`, `citations`) are the same in both. 20260318 adds `useCache` / `responseInclusion` for fetch, which the Hub does not set. 20260209 sends the `code-execution-web-tools-2026-02-09` beta header | `assistant-attachments-web.test.ts`; Hub `partner.test.ts` |
| Assistant: model, Deep think, step and output caps | ✅ same | Everything comes from the Hub's `assistant-config`, which serves the very constants the Hub's route uses (`MAX_STEPS`, `MAX_OUTPUT_TOKENS`, `THINKING`, `effortFor`, `WEB_TOOLS`, the attachment limits). Ask Sunny only bounds them (steps ≤ 12, output ≤ 16,000, attachments ≤ the Hub's) and uses the Hub's values if an older Hub does not send them. Also the Hub's system-prompt cache breakpoint | `assistant-attachments-web.test.ts` |
| Assistant: cost | Ask Sunny's own | The spend guard runs before every answer (before the Hub and the model). Each answer's tokens, including attachment and web-result tokens, are written as a spend row, with `webSearchRequests` from Anthropic's usage (`server_tool_use.web_search_requests`). Neither app has a per-search price, so the budget counts tokens only; the count is there for when a price is set | `assistant-attachments-web.test.ts` |
| Assistant: "Open as document" | ✅ same | The Hub's `ArtifactPane` + `artifact-context` + `OpenDocumentButton`: plain React with no assistant-ui. It has Copy, Word (`.doc`) and `.md` downloads, made in the browser, and never renders images (`markdown-prose.tsx`: the Hub's `proseClass` / `noImages`). An open document widens the panel; Shrink, New chat and opening a past chat close it. The Hub's partner prompt now says it works here | `assistant/open-document.dom.test.tsx`; Hub `partner.test.ts` |

## Issue files: a reviewed widening of the Hub's service key

Approved by QA on 13 Nov 2026 under the condition "built narrow". The Hub's own file code
(`src/lib/meetings/files.server.ts`: prepare, finish, open) runs unchanged. Only its Storage client differs:

- **One server-only module.** `src/lib/partner/service.server.ts` → `partnerFilesClient`. Bucket `l10-files` only, and
  only paths under `<meetingKey>/`. A path with `..`, another meeting's folder, or another bucket is refused there
  without calling Storage.
- **The database first.** Every file op starts with `l10_partner_whoami(partner, email)`, which checks the allowlist,
  that the account can sign in, and the meeting role. Only a meeting it returns gets a Storage client. Another
  partner, a non-member, or another meeting gets a 404 and no Storage call.
- **The Hub's checks.** Name, type, size (25 MB), path (`parseNewPath` / `parseOpenPath`), and the stored object's
  real size and first bytes, all from the Hub's code. Ask Sunny also checks these before calling the Hub.
- **Shortest links.**
  - Read links are clamped to **60 s** (the Hub's own page uses 1 h).
  - Upload addresses: Supabase fixes `createSignedUploadUrl` at **2 hours**, and that cannot be configured (storage-js
    has no expiry option). That is the same as the Hub's own uploads. QA asked for ≤ 2 min, which is not possible
    with Supabase signed uploads. **QA accepted this on 13 Nov 2026**: it is the Hub's own behaviour and a Supabase
    limit, and the database check and the pinned path come before any upload address is made.
- **Never list or delete.** The key only signs. Removal follows the Hub's rule: Remove takes the file off the issue
  (a meeting save), and the stored copy is kept.
- **Guarded.** Hub `partner.test.ts`:
  - only `service.server.ts` reads the key;
  - it has exactly one `.storage` use, `serviceClient(config).storage.from(L10_BUCKET)`;
  - none of list / remove / upload / download / move / copy / update / bucket admin is called;
  - the route never touches Storage.

## Copied files that differ (besides the header line)

| File | Difference | Why |
| --- | --- | --- |
| `lib/config.ts`, `lib/doc.ts`, `MeetingView.tsx` | Roster (members, leader, roles) comes from the Hub per request, not constants | Public repository: no people's names |
| `MeetingView.tsx` | "Open in Leadership Hub ↗" instead of "← All meetings" and Sign out; recaps link → `/meetings/<key>/recaps` | One meeting here; Ask Sunny has its own sign-out |
| `Conclude.tsx` | `recapsHref` prop | Recaps path differs |
| `DeleteRecapButton.tsx` | Stays on the current path after delete | Recaps path differs |
| `lib/files.ts` | The five Salon file types are inlined | Ask Sunny has no Salon files module |
| `SharedFiles.tsx`, `RestoreButton.tsx`, `MentionPicker.tsx`, `chat-mentions.ts`, `Rocks.tsx`, `Todos.tsx`, `notifications/logic.ts` | Imports only; example names in comments made up | — |
| `NoteCard.tsx`, `notes.ts` | Example names made up; the send goes to Ask Sunny's server action | Public repository |
| `NotificationBell.tsx`, `NotificationsView.tsx` | "See all" / "Settings" open the Hub | One meeting here |
| `assistant/storage.ts` | Key prefix and per-user scope | Keeps it separate from the Hub's history and from other Ask Sunny users |
| `report/page.tsx`, `recaps/page.tsx` | One meeting, inside `L10Frame`, through `openMeeting` (404 for anyone the Hub refuses) | One meeting here |
| `Ids.tsx`, `lib/doc.ts`, `lib/types.ts` | IDS tabs Short term / Long-term / Recently solved (Ask Sunny #945) | **Back in sync** (14 Nov 2026): the Hub has the same tabs since [Glowbrands1/leadership-hub#72](https://github.com/Glowbrands1/leadership-hub/pull/72). Same markup, tab labels, "Move to long-term / short term", new issue on the open tab, long-term issues unranked |
| `Ids.tsx` | IDS ranking off (`RANKING = false`) | **Same behaviour for stc-dm** since Hub #72: the Hub turns ranking off per meeting (`idsRanking(key)`, `IDS_WITHOUT_RANKING` = stc-dm, bcs-dm, bcs-gm), Ask Sunny off everywhere (it opens only stc-dm). Same IDS hint for stc-dm ("Identify, Discuss, Solve. Work each issue through, then press Solve."), served by the Hub with the roster. Left: the switch itself (a constant here, `idsRanking` in the Hub) |
| `Ids.tsx` | No adder's name on new issues yet | The Hub (#72) saves the adder's full name on each new issue (initials on the row). Ask Sunny #955 (another session) is bringing it here |
| `meeting/_components/PastMeetings.tsx`, `lib/past.ts`, `(app)/meetings/[key]/past` | Bloom Growth meetings (`meetingHistory`) on their own "Past meetings" page, times in Central | The Hub (#72) shows the same imported meetings on its Recaps page under "Earlier meetings, from Bloom Growth"; same data and times, different page |
| `AssistantPanel.tsx` | The Hub's panel markup on `useChat` (not assistant-ui); the Hub's `OpenDocumentButton` / `AnswerText` inside it | AI SDK 6 in Ask Sunny |
| `ArtifactPane.tsx`, `artifact-context.tsx` | Imports only | — |
| `markdown-prose.tsx` | Only `proseClass` / `noImages` from the Hub's `Markdown.tsx` | The Hub's streaming renderer is assistant-ui's |
