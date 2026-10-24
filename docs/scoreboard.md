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
- commit: `00f39ab05d83ccfef88331ff34dfab541775cd02`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED`
- runs: 3
- latency gate: 20000 ms

| Case | Card criteria | Flags off | Flags on |
| --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 221ms | PASS 3130ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 132ms | PASS 486ms |
| s11 | Colene Schildt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 97ms | PASS 457ms |
| s5 | Lisa Smith · loc-0468 · 2026-10-23 · — | PASS 61ms | PASS 433ms |
| s27 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 210ms | PASS 635ms |
| s28 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 32ms | PASS 115ms |
| s29 | Erin Nelson · loc-0313 · — · — | PASS 19ms | PASS 66ms |
| s17 | Betty Sue · — · 2026-10-23 · — | PASS 63ms | PASS 358ms |
| s20 | — · — · — · — | PASS 32ms | PASS 343ms |
| s21 | Kennedy Morehouse · loc-0410 · 2026-10-05 · — | PASS 118ms | PASS 401ms |
| s25 | Pasiley Peklo · loc-0313 · — · — | PASS 31ms | PASS 143ms |
| s8 | Christiana Headley · loc-0463 · — · — | PASS 106ms | PASS 1127ms |
| s12 | Colene Schildt · loc-0462 · — · — | PASS 22ms | PASS 195ms |
| s16 | Kayla Koehn · loc-0309 · — · — | PASS 18ms | PASS 182ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 47ms | PASS 347ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 129ms | PASS 603ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 84ms |
| b12 | Sadie Hoffart · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 103ms | PASS 772ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 28ms | PASS 210ms |
| n2 | Colene Shildt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 9ms | PASS 49ms |
| n3 | TT · — · 2026-10-23 · — | PASS 7ms | PASS 68ms |

Harness events (not case failures):

- conv-s4-on: resend-first-message × 15
- conv-s11-on: resend-first-message × 3
- conv-s27-on: resend-first-message × 3
- conv-s8-on: resend-first-message × 12
- conv-s4-off: resend-first-message × 15
- conv-s11-off: resend-first-message × 3
- conv-s27-off: resend-first-message × 3
- conv-s8-off: resend-first-message × 12

## Round 3 — prompt A/B

- replay_set.json sha256: `2f05db5d08424743a1be74caf8265ed3decfac28fdbda5bcf3c4259282daa611`
- prompts.ts sha256: `e7f952b0f922eebbf1b74cc11d747e758a2ece4139b3940d2fadb40e12f3dc75`
- commit: `25939d561632b41d75e3f1f34e798577714f620b`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED`
- runs: 3
- latency gate: 20000 ms
- last-known-good prompt commit: `417e80c12d7275681411606f87af851fb080b348`
- last-known-good prompts.ts sha256: `0c6b9f2efdbdc054d3f7832f5002e92c844a5b95e72622e096328ac2c2ee218d`
- built prompt sha256, current: `9db71e40e13798495a542ee1c988276b6e979d9a3f2ab8d5e7df59ba9e2dfbf3`
- built prompt sha256, last-known-good: `9db71e40e13798495a542ee1c988276b6e979d9a3f2ab8d5e7df59ba9e2dfbf3`
- prompt text differs: no
- prompt revert: none

| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |
| --- | --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 220ms | PASS 3526ms | PASS 1282ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 128ms | PASS 526ms | PASS 533ms |
| s11 | Colene Schildt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 93ms | PASS 485ms | PASS 464ms |
| s5 | Lisa Smith · loc-0468 · 2026-10-23 · — | PASS 58ms | PASS 469ms | PASS 461ms |
| s27 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 264ms | PASS 681ms | PASS 677ms |
| s28 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 44ms | PASS 129ms | PASS 128ms |
| s29 | Erin Nelson · loc-0313 · — · — | PASS 25ms | PASS 70ms | PASS 66ms |
| s17 | Betty Sue · — · 2026-10-23 · — | PASS 82ms | PASS 366ms | PASS 361ms |
| s20 | — · — · — · — | PASS 32ms | PASS 342ms | PASS 324ms |
| s21 | Kennedy Morehouse · loc-0410 · 2026-10-05 · — | PASS 116ms | PASS 417ms | PASS 409ms |
| s25 | Pasiley Peklo · loc-0313 · — · — | PASS 34ms | PASS 150ms | PASS 144ms |
| s8 | Christiana Headley · loc-0463 · — · — | PASS 107ms | PASS 1085ms | PASS 1056ms |
| s12 | Colene Schildt · loc-0462 · — · — | PASS 24ms | PASS 153ms | PASS 151ms |
| s16 | Kayla Koehn · loc-0309 · — · — | PASS 18ms | PASS 183ms | PASS 175ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 45ms | PASS 351ms | PASS 348ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 126ms | PASS 609ms | PASS 603ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 91ms | PASS 85ms |
| b12 | Sadie Hoffart · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 99ms | PASS 793ms | PASS 799ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 28ms | PASS 215ms | PASS 221ms |
| n2 | Colene Shildt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 9ms | PASS 51ms | PASS 48ms |
| n3 | TT · — · 2026-10-23 · — | PASS 6ms | PASS 74ms | PASS 68ms |

Harness events (not case failures):

- conv-s4-on-current: resend-first-message × 15
- conv-s4-on-last-known-good: resend-first-message × 15
- conv-s11-on-current: resend-first-message × 3
- conv-s11-on-last-known-good: resend-first-message × 3
- conv-s27-on-current: resend-first-message × 3
- conv-s27-on-last-known-good: resend-first-message × 3
- conv-s8-on-current: resend-first-message × 12
- conv-s8-on-last-known-good: resend-first-message × 12
- conv-s4-off: resend-first-message × 15
- conv-s11-off: resend-first-message × 3
- conv-s27-off: resend-first-message × 3
- conv-s8-off: resend-first-message × 12

## Flag ablation — one flag at a time

Each row turns one quality flag on and leaves the others off. The reply model is mocked, so each case runs once. Floor is the flags-off checks. Card is the written card criteria. A flag is safe when every case holds the floor.

| Flag | Floor | Card criteria | Breaks the floor | Card still open |
| --- | --- | --- | --- | --- |
| INTENT_EXTRACTION_ENABLED | 20/21 | 18/21 | s17 | s17, s25, n2 |
| FEWSHOT_EXAMPLES_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| SELF_CHECK_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| QUERY_REWRITE_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| GROUNDED_ENTITIES_ENABLED | 20/21 | 14/21 | s17 | s9, s17, s25, b9, b10, b12, n2 |
| DRAFT_MERGE_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| ACTION_PLAN_SENTENCES_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| TYPED_NAME_PROCEEDS_ENABLED | 21/21 | 6/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, s25, b9, b10, b11, b12, n2, n3 |
| ATTENDANCE_POLICY_CITATION_ENABLED | 21/21 | 12/21 | — | s9, s5, s28, s29, s17, b10, b11, n2, n3 |
| POLICY_PAGE_REQUIRED_ENABLED | 21/21 | 12/21 | — | s9, s5, s28, s29, s17, b10, b11, n2, n3 |
| MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| POLICY_GATE_NONBLOCKING_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| MANUAL_SECTION_DEDUPE_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| PRINTED_PAGE_CITATION_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| PAYROLL_AMOUNT_FIELD_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |
| CODE_SLOTS_ENABLED | 20/21 | 7/21 | s17 | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |

Safe order for Pau: turn these on from the top. A flag with no floor break holds the flags-off checks on its own. A date note means the only floor miss is s17: the flag stores 2026-10-23, which the old floor leaves blank and the card criteria requires. Round 3 with every flag on passes all 21.

1. `INTENT_EXTRACTION_ENABLED` — card 18/21 — stores s17's date
2. `GROUNDED_ENTITIES_ENABLED` — card 14/21 — stores s17's date
3. `ATTENDANCE_POLICY_CITATION_ENABLED` — card 12/21
4. `POLICY_PAGE_REQUIRED_ENABLED` — card 12/21
5. `ACTION_PLAN_SENTENCES_ENABLED` — card 7/21
6. `CODE_SLOTS_ENABLED` — card 7/21 — stores s17's date
7. `DRAFT_MERGE_ENABLED` — card 7/21
8. `FEWSHOT_EXAMPLES_ENABLED` — card 7/21
9. `MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED` — card 7/21
10. `MANUAL_SECTION_DEDUPE_ENABLED` — card 7/21
11. `PAYROLL_AMOUNT_FIELD_ENABLED` — card 7/21
12. `POLICY_GATE_NONBLOCKING_ENABLED` — card 7/21
13. `PRINTED_PAGE_CITATION_ENABLED` — card 7/21
14. `QUERY_REWRITE_ENABLED` — card 7/21
15. `SELF_CHECK_ENABLED` — card 7/21
16. `TYPED_NAME_PROCEEDS_ENABLED` — card 6/21
