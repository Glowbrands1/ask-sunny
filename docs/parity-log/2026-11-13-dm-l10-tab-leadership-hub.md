## 13 Nov 2026: the DM L10 tab — the Leadership Hub's STC DM L10, inside Ask Sunny (Sunny only for now; Bubbles later by configuration)

New feature, not a fix. Ask Sunny gets a "DM L10" tab (sidebar, "Meetings") that opens the Leadership Hub's STC DM
L10 with the Hub's own page, on the Hub's own meeting record: Ask Sunny holds no copy. Its server calls the Hub's
partner API (`POST /api/partner/l10`, HMAC-signed with `HUB_PARTNER_SECRET`); the Hub's database acts as the Hub
account with the signed-in person's email, checks that account's meeting role and refuses every meeting not on its
allowlist (`l10.partner_meetings`, only `stc-dm`). Edits from Ask Sunny write the same history and notifications as
edits in the Hub; the bell shares the Hub's read state; the assistant uses the Hub's prompt, models and meeting tools
on Ask Sunny's key. Code: `src/features/l10/` (see its README). Hub side: Leadership Hub pull request on branch
`claude/blissful-wozniak-fa6337`.

Not touched: chat, forms, Corrective Action, policy citation, knowledge sync and Woven. Access/auth is touched only
to READ the verified identity (`pageIdentity`), unchanged.

Ask Bubbles: not ported in this pull request, by decision (STC gets the DM L10 now; Buff City gets the BCS DM L10 and
BCS GM L10 later). The mechanism is built to port as it is: copy `src/features/l10/`, the `(app)/meetings` routes,
the `/api/l10/assistant` route and the sidebar wiring, set `PARTNER_ID = "ask-bubbles"` and the tab labels
(`L10_TAB_LABELS`: `bcs-dm` → "DM L10", `bcs-gm` → "GM L10"), and add `bcs-dm` / `bcs-gm` to the Hub's
`l10.partner_meetings`. No company wording or people are in the code: the Hub serves the roster at request time.
