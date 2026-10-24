# Replay scoreboard

Each case runs 3 times and passes only when every run passes. Latency is those runs together and fails over 20000 ms. Flags-off and flags-on are separate columns. Flags-on is judged on the card criteria in `replay_set.json`, written before the run: employee, salon, date, policy and printed page, no blocking question, no leaked internal text. A re-send of a dropped first message is a harness event, not a case failure.

## Round 1 — code-owned slots

- replay_set.json sha256: `2f05db5d08424743a1be74caf8265ed3decfac28fdbda5bcf3c4259282daa611`
- prompts.ts sha256: `68f86ab2aad33782047d57ada4b04836c1888e6e8a2d2a2487d9a00c25786dc6`
- commit: `f4bfc6ac561094e76749f45ede4616188f20e779`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED`
- runs: 3
- latency gate: 20000 ms

| Case | Card criteria | Flags off | Flags on |
| --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 234ms | PASS 3391ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 131ms | PASS 505ms |
| s11 | Colene Schildt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 111ms | PASS 460ms |
| s5 | Lisa Smith · loc-0468 · 2026-10-23 · — | PASS 65ms | PASS 438ms |
| s27 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 211ms | PASS 654ms |
| s28 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 33ms | PASS 117ms |
| s29 | Erin Nelson · loc-0313 · — · — | PASS 18ms | PASS 68ms |
| s17 | Betty Sue · — · 2026-10-23 · — | PASS 63ms | PASS 369ms |
| s20 | — · — · — · — | PASS 32ms | PASS 341ms |
| s21 | Kennedy Morehouse · loc-0410 · 2026-10-05 · — | PASS 138ms | PASS 409ms |
| s25 | Pasiley Peklo · loc-0313 · — · — | PASS 32ms | PASS 145ms |
| s8 | Christiana Headley · loc-0463 · — · — | PASS 106ms | PASS 1082ms |
| s12 | Colene Schildt · loc-0462 · — · — | PASS 22ms | PASS 155ms |
| s16 | Kayla Koehn · loc-0309 · — · — | PASS 18ms | PASS 180ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 46ms | PASS 346ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 129ms | PASS 606ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 83ms |
| b12 | Sadie Hoffart · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 108ms | PASS 792ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 29ms | PASS 215ms |
| n2 | Colene Shildt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 9ms | PASS 48ms |
| n3 | TT · — · 2026-10-23 · — | PASS 6ms | PASS 68ms |

Harness events (not case failures):

- s4 flags-on: resend-first-message
- s4 flags-off: resend-first-message
- s11 flags-on: resend-first-message
- s11 flags-off: resend-first-message
- s27 flags-on: resend-first-message
- s27 flags-off: resend-first-message
- s8 flags-on: resend-first-message
- s8 flags-off: resend-first-message

## Round 2 — close-match note under the card

- replay_set.json sha256: `2f05db5d08424743a1be74caf8265ed3decfac28fdbda5bcf3c4259282daa611`
- prompts.ts sha256: `68f86ab2aad33782047d57ada4b04836c1888e6e8a2d2a2487d9a00c25786dc6`
- commit: `1696015691acb5b6d220c20b1c506d5d0e89c144`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED`
- runs: 3
- latency gate: 20000 ms

| Case | Card criteria | Flags off | Flags on |
| --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 262ms | PASS 3148ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 138ms | PASS 501ms |
| s11 | Colene Schildt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 102ms | PASS 470ms |
| s5 | Lisa Smith · loc-0468 · 2026-10-23 · — | PASS 63ms | PASS 447ms |
| s27 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 215ms | PASS 649ms |
| s28 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 33ms | PASS 116ms |
| s29 | Erin Nelson · loc-0313 · — · — | PASS 18ms | PASS 66ms |
| s17 | Betty Sue · — · 2026-10-23 · — | PASS 63ms | PASS 360ms |
| s20 | — · — · — · — | PASS 32ms | PASS 344ms |
| s21 | Kennedy Morehouse · loc-0410 · 2026-10-05 · — | PASS 119ms | PASS 407ms |
| s25 | Pasiley Peklo · loc-0313 · — · — | PASS 33ms | PASS 145ms |
| s8 | Christiana Headley · loc-0463 · — · — | PASS 105ms | PASS 1080ms |
| s12 | Colene Schildt · loc-0462 · — · — | PASS 23ms | PASS 152ms |
| s16 | Kayla Koehn · loc-0309 · — · — | PASS 17ms | PASS 186ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 46ms | PASS 347ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 130ms | PASS 622ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 89ms |
| b12 | Sadie Hoffart · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 101ms | PASS 978ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 28ms | PASS 266ms |
| n2 | Colene Shildt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 10ms | PASS 53ms |
| n3 | TT · — · 2026-10-23 · — | PASS 6ms | PASS 70ms |

Harness events (not case failures):

- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s4-on: resend-first-message
- conv-s11-on: resend-first-message
- conv-s11-on: resend-first-message
- conv-s11-on: resend-first-message
- conv-s27-on: resend-first-message
- conv-s27-on: resend-first-message
- conv-s27-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s8-on: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s4-off: resend-first-message
- conv-s11-off: resend-first-message
- conv-s11-off: resend-first-message
- conv-s11-off: resend-first-message
- conv-s27-off: resend-first-message
- conv-s27-off: resend-first-message
- conv-s27-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
- conv-s8-off: resend-first-message
