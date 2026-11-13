# The DM L10 tab (Leadership Hub meeting inside Ask Sunny)

The **STC DM L10** from the Leadership Hub, opened in Ask Sunny with the Hub's own page, on the Hub's own record.
The Leadership Hub is the single source of truth: Ask Sunny stores no meeting data.

## How it works

```
browser ──► Ask Sunny page / Server Function / /api/l10/assistant
              │  verified session only (pageIdentity: live Supabase session + active app_users row)
              ▼
            data.server.ts ──► partner/client.server.ts ──HMAC──►  Leadership Hub  POST /api/partner/l10
                                                                       │  signature, 5-min window, one-time nonce,
                                                                       │  per-person rate limit, else 404
                                                                       ▼
                                                     Hub database: public.l10_partner_* (service_role only)
                                                       · finds the Hub account by email (case-insensitive)
                                                       · checks that account's meeting role (has_role_for)
                                                       · refuses any meeting not on l10.partner_meetings (stc-dm)
                                                       · saves through the SAME bodies as the Hub's own saves
                                                         (history, recaps, notifications identical)
```

- **Who sees it.** The sidebar tab (`(app)/layout.tsx` → `l10TabsForLayout`) shows only for people the Hub lists for
  an allowlisted meeting; cached 5 minutes per person for the link only. Every page, Server Function and assistant
  call asks the Hub again. A refused meeting (Leadership L10, or a person who is not an attendee) is a plain 404.
- **Sync.** The Hub's page logic as it is (`meeting/useMeetingSync.ts`): saves carry the version they were based on,
  a stale save comes back with the latest and is merged item by item, and the page polls every 4 seconds, so an edit
  in either app shows in the other within seconds. "All changes saved" shows only after the Hub confirmed the save.
- **Bell.** The Hub's notifications, the same rows and read state (`ui/NotificationBell.tsx`, 60-second refresh), for
  the meetings Ask Sunny may open. "See all" and "Settings" open the Hub.
- **Assistant.** `assistant/` + `/api/l10/assistant`: the Hub's system prompt, model settings and its `getMeeting` /
  `getMeetingRecaps` tools (run by the Hub, as this person), on Ask Sunny's own `ANTHROPIC_API_KEY`. Per-person rate
  limit as in the Hub (20 messages / 10 minutes).
- **Look.** The DM L10 section at the end of `src/app/globals.css` adds the Hub's colour tokens and glass utilities; everything that would clash with Ask Sunny's
  tokens is set inside `.hub-l10` only. Fonts (Public Sans, JetBrains Mono) load on these pages only.

## What is copied from the Hub, and what differs

Copied with the same structure (each file says where it came from): `lib/` (from `src/lib/meetings`, mentions,
tracker), `meeting/` (from `src/app/meetings`), `ui/` (from `src/components`), `notifications/` (logic, types, view).
The Hub's page code runs unchanged except:

| Hub | Here | Why |
| --- | --- | --- |
| `MEMBERS`, `FULL_NAMES`, `MEETING_LEADER`, `KNOWN_ROLES` in config | `Roster`, served by the Hub per request | this repository is public: no people in it |
| `MEETING_CATALOG` (every meeting's name and description) and the meetings picker | not copied; names come from the Hub with the meeting | one meeting here; no other company's wording in this repository |
| "← All meetings" | "Open in Leadership Hub ↗" | one meeting here; the rest is in the Hub |
| Files on an issue (SharedFiles) | a link to the meeting in the Hub | not in v1 |
| History: Restore (Hub admins) | a link to the Hub's history | not in v1 |
| Recaps page, Tracker, notification settings | links to the Hub | not in v1 |
| Assistant on assistant-ui | the same markup on `@ai-sdk/react` | assistant-ui needs AI SDK 7 and a newer Radix |
| Assistant: attachments, chat history, @-mentions, note cards, web search, documents | not here | not in v1 (only in the Hub) |
| IDS ranking ("Everyone's top three", Rank buttons, Priority badges) | off (`RANKING = false` in `Ids.tsx`) | the team works IDS as in Bloom Growth, without ranking (14 Nov 2026) |

When the Hub's meeting page changes, re-copy the file and re-apply the row above that concerns it.

## Settings

- `HUB_PARTNER_SECRET` (server only): the same value as in the Hub's Vercel project. Unset: no tab, every page 404.
- `NEXT_PUBLIC_LEADERSHIP_HUB_URL` (existing): the Hub's address, for its API and the "Open in Leadership Hub" links.
- `ANTHROPIC_API_KEY` (existing): the assistant.

## For Ask Bubbles (later: BCS DM L10 and BCS GM L10)

Copy this folder, the `(app)/meetings` routes, `/api/l10/assistant` and the sidebar wiring; set `PARTNER_ID` to
`"ask-bubbles"` and `L10_TAB_LABELS` for `bcs-dm` / `bcs-gm`; add those keys to the Hub's `l10.partner_meetings`.
See `docs/parity-log/2026-11-13-dm-l10-tab-leadership-hub.md`.
