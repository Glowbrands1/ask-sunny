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
| Rock Review: "Add new rock" form at the TOP, under the section title (owner's request, 13 Nov 2026) | ✅ same | The same change in both apps' `Rocks.tsx`, for every meeting; behaviour unchanged | `meeting/_components/Rocks.order.dom.test.tsx`; Hub `Rocks.order.test.tsx` |
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
| `Ids.tsx`, `lib/doc.ts`, `lib/types.ts` | IDS tabs Short term / Long-term / Recently solved (Ask Sunny #945, `docs/parity-log/2026-11-14-dm-l10-ids-short-long-term.md`) | Ahead of Hub `main`: the same change is in the open Hub PR [Glowbrands1/leadership-hub#72](https://github.com/Glowbrands1/leadership-hub/pull/72); once it merges they match again |
| `Ids.tsx` | IDS ranking off: no "Everyone's top three", Rank buttons or Priority badges (`RANKING = false`; `docs/parity-log/2026-11-14-dm-l10-ids-no-ranking.md`) | The team's choice (14 Nov 2026): IDS worked as in Bloom Growth. Keep it when re-copying `Ids.tsx` |
| `meeting/_components/PastMeetings.tsx`, `lib/past.ts`, `(app)/meetings/[key]/past` | Ask Sunny only: recaps plus the meetings imported from Bloom Growth (`meetingHistory`), times in Central | The Bloom history is not in the Hub's recaps table |
| `AssistantPanel.tsx` | The Hub's panel markup on `useChat` (not assistant-ui); the Hub's `OpenDocumentButton` / `AnswerText` inside it | AI SDK 6 in Ask Sunny |
| `ArtifactPane.tsx`, `artifact-context.tsx` | Imports only | — |
| `markdown-prose.tsx` | Only `proseClass` / `noImages` from the Hub's `Markdown.tsx` | The Hub's streaming renderer is assistant-ui's |
