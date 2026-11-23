# One tab never gets another tab's card (Ask Bubbles #1079, its QA's duplicate-tab finding, 23 Nov 2026) — ported

**Ported from Bubbles #1079's PR head 54ee4c517, before it merged.** If #1079 changes before it merges, this port follows.

**Report (Ask Bubbles):** the open chat's id is in the address (`?c=<id>`) and the chat screen adopts it on load, so a
second tab opened on it (Duplicate tab, a copied address) posts to the same conversation id. The loop's records are
read by conversation id, so that tab's turn took the first tab's card as the chat's card: its reply was checked
against it, and its carries were read from it.

**Ask Sunny: same gap.** Sunny's `readLoopRecords` reads by conversation id the same way. The replay case below fails
on main: tab B's reply is handed back against tab A's card.

**Port (the mechanism; Sunny's own staff, person invented):**
- `agent-loop/card-record.ts`: `readLoopRecords` takes `thisTab` (the request's own manager turns: ids and question
  keys). A record counts only when it is this request's own: its message is one of these turns, by id or question key,
  or it is older than the earliest record that is (the history sent is the latest turns only). A tab with no turns yet
  has none. With nothing of the history found, every record counts, as before (`ownRecords`).
- `run.ts`: passes this request's history ids and question keys (`personKey` of each manager turn, as `question_key`
  is written).
- Replay harness: `thread()` takes a conversation id and an id prefix (a second tab).
- `settled-names.ts` (a card by its proposal id) is unchanged, as in Bubbles.

**Not ported, already in Sunny:** Bubbles' second part, "the home band sends its conversation id". Sunny's
`use-inline-ask.ts` already sends its conversation id on every send, the first included (QA, 16 Nov 2026, production
chat_traces). Bubbles' parity note saying Sunny's band sends none is out of date.

**Tests:** `own-records.test.ts` (4 tests); replay `nov23-two-tabs-one-conversation-no-crossed-card`: fails on main in
both flag modes (tab B's reply handed back against tab A's card), passes here.

**Live harness:** not run here (QA runs the live set). The case uses the stand-in model and skips under
`AGENT_LOOP_LIVE=1`; live, the check is two browser tabs on one chat address.
