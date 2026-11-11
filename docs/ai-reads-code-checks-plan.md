# Plan: the AI reads the chat, the code checks it, one question if unsure

Status: plan only. Nothing here is built. QA asked for it alongside the
variation report (27 Oct 2026).

## Why

The variation report (`npm run variation-report`) replays QA's seeds S1–S15
with automatic variants (case, punctuation, spacing, typos, date forms, name
forms) through the same server path as the e2e tests:

| mode | variants fully right |
|---|---|
| production flags | 24% (58/241) |
| production + this week's fixes | 67% (161/241) |

Each fix this week was a new reader for one wording. Most of the misses that
remain are the same kind: name forms (31% fully right), typos (56%) and date
forms (67%). Adding one more pattern for each new wording does not end.

## What exists

- Ask Sunny already has half of this. With `INTENT_EXTRACTION_ENABLED` (live),
  one Haiku tool call (`ai/intent-extraction.ts`, `record_intent_slots`, max
  500 tokens) reads the slots, and `ai/intent-slots.ts` grounds them. But code
  readers still run after it and can override any field (`keep-filled-slots`,
  `edit-date-rules`, `statedFormDate`, …).
- Ask Bubbles has this off.

## The design

1. **AI reads.** One call per manager turn on a form. For each field it gives
   the value **and the exact words it took the value from** (`evidence`):
   employee, store/salon, job title, incident, incident date(s), prior steps
   and their dates, payroll amount, warning level, form, policy heading.
2. **Code checks.** Each field passes or fails one check. Nothing is guessed.
   - The evidence is in the manager's own turns. Ignore case and spacing. The
     app's own lines don't count.
   - The employee is on the roster (exact match, nickname, or a one-letter
     typo).
   - A date parses, is not in the future, and is not a step or follow-up
     date. These rules already exist and are reused.
   - The policy heading is in the manual list.
   - The location is one the manager is allowed to see.
3. **One question if unsure.** When a field fails, it stays blank. The reply
   asks **one** question, about the most important blank field (employee >
   date > incident > the rest). The same question is never asked twice
   (the existing anti-loop marker).
4. A field the code reader and the AI agree on is filled as today. When they
   disagree, the field is left blank and asked about. It is never silently
   swapped.

## Files and flags

- New flag `AI_READS_CODE_CHECKS_ENABLED`, default off, with the same name in
  both apps. It is listed in flags-off-parity.
- New `src/lib/ai/reader/read.ts`: the call, the schema and the evidence spans.
- New `src/lib/ai/reader/check.ts`: one checker per field, reusing the
  existing roster, date and manual helpers.
- New `src/lib/ai/reader/ask.ts`: picks the one question.
- Hook: in `intent-extraction.ts` and `server-ask.ts`, the same place the
  intent path joins today.
- No protected file (`form-proposal.ts`, `proposal.ts`, `revision.ts`, …) is
  edited. The reader hands the card slots in the same way the intent path
  does.
- Bubbles: the same files, ported with store wording.

## Cost per chat (Anthropic list price)

One call per manager turn. About 6k input tokens (instructions, manual
headings, scoped roster, history) and about 400 output tokens.

| model | per turn | per 6-turn chat |
|---|---|---|
| Haiku 4.5 (today's intent model, $1 / $5 per M) | ~$0.008 | ~$0.05 |
| Haiku 5.5 ($0.10 / $0.50 per M) | ~$0.0008 | ~$0.005 |

Per month: (chats in the last 14 days ÷ 14 × 30) × the per-chat figure. QA
will supply the 14-day chat count from both databases.

Prompt caching on the fixed part (instructions and manual headings) lowers
both figures. Haiku 5.5 thinks by default: run it at `low` effort, or the
output tokens grow.

## Risks

- **Latency:** about 1 s more per turn. The call runs alongside the manual
  retrieval.
- **Made-up values:** the evidence check catches them, because a value with
  no quote in the manager's words is dropped.
- **Model changes:** pin the model id, and use the variation report as the
  gate before any model switch.
- **Too many questions:** at most one per turn, never repeated. The variation
  report's "one question" row measures it (78% with this week's fixes).
- **Roster sent to the model:** the intent path already sends it, scoped to
  the manager's locations. Nothing new leaves the app.
- **Tests:** the e2e tests use a stubbed model, so they test the checks, not
  the reading. A small recorded set of real model replies keeps CI offline.

## Ship gate (QA, 27 Oct 2026)

- A third mode of the report ("production + AI reader") must beat today's
  67% fully right **and** lose on no seed or field that passes today (policy,
  prior, date). Otherwise it does not ship.
- That mode also reports the "one question" row and an "asked twice" count,
  since leaving a disputed field blank can add questions.

## When the model is down

A timeout (2 s), an error or an unusable reply means the turn runs on
today's readers, exactly as with the flag off. The card is never left blank
because the model failed. Each fallback is counted in the chat trace.

## Estimate

- Sunny: 3–5 days to build and test. Then the variation report in a third
  mode ("production + AI reader"), measured against the 67%.
- Bubbles port: 1–2 days.
- Each app's live flag flip is Pau's call, after QA.
