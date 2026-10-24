# Replay scoreboard

Each case runs 1 time and passes only when every run passes. Latency is those runs together and fails over 20000 ms. Flags-off and flags-on are separate columns. Flags-on is judged on the card criteria in `replay_set.json`, written before the run: employee, salon, date, policy and printed page, no blocking question, no leaked internal text. A re-send of a dropped first message is a harness event, not a case failure.

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
- prompts.ts sha256: `d288d4f4b72082321f11a7bdaa839bf5f8d2f4841cd2c22d3b4ddf6332033312`
- commit: `923dcedaf1f5a75791ccee5e8eef3fdc4729911a`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED`
- runs: 1
- latency gate: 20000 ms
- last-known-good prompt commit: `417e80c12d7275681411606f87af851fb080b348`
- last-known-good prompts.ts sha256: `0c6b9f2efdbdc054d3f7832f5002e92c844a5b95e72622e096328ac2c2ee218d`
- built prompt sha256, current: `b3bcd4ccc5b51b48c729b9a2350e0edf4c5866858b0fe05b47d1c7f78786e252`
- built prompt sha256, last-known-good: `b3bcd4ccc5b51b48c729b9a2350e0edf4c5866858b0fe05b47d1c7f78786e252`
- prompt text differs: no
- prompt revert: none

| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |
| --- | --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 77ms | PASS 2368ms | PASS 421ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 44ms | PASS 169ms | PASS 166ms |
| s11 | Colene Schildt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 35ms | PASS 164ms | PASS 152ms |
| s5 | Lisa Smith · loc-0468 · 2026-10-23 · — | PASS 21ms | PASS 147ms | PASS 122ms |
| s27 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 72ms | PASS 225ms | PASS 219ms |
| s28 | Erin Nelson · loc-0313 · — · Standards of Conduct p.12 | PASS 11ms | PASS 41ms | PASS 40ms |
| s29 | Erin Nelson · loc-0313 · — · — | PASS 7ms | PASS 23ms | PASS 23ms |
| s17 | Betty Sue · — · 2026-10-23 · — | PASS 22ms | PASS 119ms | PASS 113ms |
| s20 | — · — · — · — | PASS 11ms | PASS 112ms | PASS 95ms |
| s21 | Kennedy Morehouse · loc-0410 · 2026-10-05 · — | PASS 40ms | PASS 145ms | PASS 138ms |
| s25 | Pasiley Peklo · loc-0313 · — · — | PASS 11ms | PASS 54ms | PASS 49ms |
| s8 | Christiana Headley · loc-0463 · — · — | PASS 37ms | PASS 409ms | PASS 387ms |
| s12 | Colene Schildt · loc-0462 · — · — | PASS 9ms | PASS 53ms | PASS 52ms |
| s16 | Kayla Koehn · loc-0309 · — · — | PASS 6ms | PASS 68ms | PASS 66ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 16ms | PASS 115ms | PASS 114ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 44ms | PASS 213ms | PASS 212ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 5ms | PASS 29ms | PASS 28ms |
| b12 | Sadie Hoffart · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 35ms | PASS 264ms | PASS 260ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 10ms | PASS 77ms | PASS 72ms |
| n2 | Colene Shildt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 3ms | PASS 18ms | PASS 17ms |
| n3 | TT · — · 2026-10-23 · — | PASS 2ms | PASS 22ms | PASS 22ms |

Harness events (not case failures):

- conv-s4-on-current: resend-first-message × 5
- conv-s4-on-last-known-good: resend-first-message × 5
- conv-s11-on-current: resend-first-message
- conv-s11-on-last-known-good: resend-first-message
- conv-s27-on-current: resend-first-message
- conv-s27-on-last-known-good: resend-first-message
- conv-s8-on-current: resend-first-message × 4
- conv-s8-on-last-known-good: resend-first-message × 4
- conv-s4-off: resend-first-message × 5
- conv-s11-off: resend-first-message
- conv-s27-off: resend-first-message
- conv-s8-off: resend-first-message × 4
- conv-s4-r1off-s4: resend-first-message × 5

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
| CHAT_DATA_TOOLS_ENABLED | 21/21 | 7/21 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3 |

Safe order for Pau: turn these on from the top. A flag with no floor break holds the flags-off checks on its own. A date note means the only floor miss is s17: the flag stores 2026-10-23, which the old floor leaves blank and the card criteria requires. Round 3 with every flag on passes all 21.

1. `INTENT_EXTRACTION_ENABLED` — card 18/21 — stores s17's date
2. `GROUNDED_ENTITIES_ENABLED` — card 14/21 — stores s17's date
3. `ATTENDANCE_POLICY_CITATION_ENABLED` — card 12/21
4. `POLICY_PAGE_REQUIRED_ENABLED` — card 12/21
5. `ACTION_PLAN_SENTENCES_ENABLED` — card 7/21
6. `CHAT_DATA_TOOLS_ENABLED` — card 7/21
7. `CODE_SLOTS_ENABLED` — card 7/21 — stores s17's date
8. `DRAFT_MERGE_ENABLED` — card 7/21
9. `FEWSHOT_EXAMPLES_ENABLED` — card 7/21
10. `MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED` — card 7/21
11. `MANUAL_SECTION_DEDUPE_ENABLED` — card 7/21
12. `PAYROLL_AMOUNT_FIELD_ENABLED` — card 7/21
13. `POLICY_GATE_NONBLOCKING_ENABLED` — card 7/21
14. `PRINTED_PAGE_CITATION_ENABLED` — card 7/21
15. `QUERY_REWRITE_ENABLED` — card 7/21
16. `SELF_CHECK_ENABLED` — card 7/21
17. `TYPED_NAME_PROCEEDS_ENABLED` — card 6/21

`CHAT_DATA_TOOLS_ENABLED` is also scored on s22 and s23. The turns are verbatim. The reply model is mocked, so a data case passes when the flag attaches the block the answer was missing. The review read in this harness is the page inventory the earlier miss named, 254 reviews. The chooser is stubbed the same way the other tools are, because the model is mocked.

| Case | Flag off | Flag on |
| --- | --- | --- |
| s22 | miss | miss |
| s23 | miss | pass |

s22 is miss with the flag on and miss with it off. Both turns say "change my password", and the help text is attached only for a reset, a forgotten password, or a sign-in failure. s23 passes with the flag on and misses with it off. The flag attaches "The Google Reviews page holds 254 reviews in total". The other 21 cases hold the floor.


## Rulebook — old behaviour against guide v3

OLD is `origin/main` as-is, flags off, the same turns and the same mocked reply. NEW is this branch with the rulebook flags on. The guide was not pasted over the system prompt. Each case runs 1 time. A rule misses if any run misses it. A rule that does not apply to the case is not scored. Worse means NEW misses a rule OLD passed, and that case is fixed before this pull request is ready.

- OLD commit: `b9ae362fd80e1fc492c4326f80834cf105ef19b8`
- NEW commit: `923dcedaf1f5a75791ccee5e8eef3fdc4729911a`
- runs: 1
- latency gate: 20000 ms for the run
- rules: employee on the card, typed name kept, salon does not gate the card, date, policy and printed page, 2-sentence plan, payroll amount only from the manager, no blocking question, no leaked text, latency

| Case | OLD | NEW | Verdict |
| --- | --- | --- | --- |
| s4 | date, policy, plan, amount, leaked | pass | better |
| s9 | date, policy, plan, leaked | pass | better |
| s11 | employee, typed, policy, leaked | pass | better |
| s5 | employee, typed, date, leaked | pass | better |
| s27 | salon, policy, plan | pass | better |
| s28 | salon, policy, plan | pass | better |
| s29 | salon | pass | better |
| s17 | date, leaked | pass | better |
| s20 | pass | pass | same |
| s21 | pass | pass | same |
| s25 | employee, typed, blocking, leaked | pass | better |
| s8 | blocking | pass | better |
| s12 | pass | pass | same |
| s16 | pass | pass | same |
| b9 | employee, typed, policy, plan, blocking | pass | better |
| b10 | employee, typed, salon, date, policy, plan, leaked | pass | better |
| b11 | employee, typed, salon, policy, plan | pass | better |
| b12 | date, policy, plan | pass | better |
| n1 | employee, typed, leaked | pass | better |
| n2 | employee, typed, policy, plan, amount, blocking, leaked | pass | better |
| n3 | date, leaked | pass | better |

Totals: better 17, same 4, worse 0.


## Round 1 — structural name, slot, and salon

One round, one commit. SELF_CHECK stays off. Judged rules are the structural ones: employee on the card, typed name kept, salon does not gate the card, date slot, no blocking question, no leaked text. Before is flags off. After is this flag set. Latency is the run. It regresses when it is more than 25% slower than the slower of the previous round and this process's flags-on run, and also more than 250ms slower.

- commit: `923dcedaf1f5a75791ccee5e8eef3fdc4729911a`
- harness: local
- flag set: `INTENT_EXTRACTION_ENABLED=1 GROUNDED_ENTITIES_ENABLED=1 DRAFT_MERGE_ENABLED=1 TYPED_NAME_PROCEEDS_ENABLED=1 CODE_SLOTS_ENABLED=1 SELF_CHECK_ENABLED=false`
- SELF_CHECK_ENABLED=false
- SELF_CHECK: off
- runs: 1
- accepted: yes

| Case | Before | After | Latency | Round |
| --- | --- | --- | --- | --- |
| s4 | pass | pass | 257ms vs 3059ms | held |
| s9 | date | pass | 147ms vs 485ms | fixed |
| s11 | pass | pass | 140ms vs 452ms | held |
| s5 | date | pass | 115ms vs 439ms | fixed |
| s27 | pass | pass | 194ms vs 630ms | held |
| s28 | salon | pass | 35ms vs 117ms | fixed |
| s29 | salon | pass | 21ms vs 66ms | fixed |
| s17 | date | pass | 103ms vs 360ms | fixed |
| s20 | pass | pass | 85ms vs 334ms | held |
| s21 | pass | pass | 126ms vs 398ms | held |
| s25 | blocking | pass | 46ms vs 146ms | fixed |
| s8 | blocking | pass | 361ms vs 1056ms | fixed |
| s12 | pass | pass | 48ms vs 151ms | held |
| s16 | pass | pass | 61ms vs 178ms | held |
| b9 | blocking | pass | 102ms vs 345ms | fixed |
| b10 | employee, typed, salon, date | pass | 192ms vs 603ms | fixed |
| b11 | employee, typed, salon | pass | 25ms vs 87ms | fixed |
| b12 | pass | pass | 247ms vs 762ms | held |
| n1 | pass | pass | 69ms vs 212ms | held |
| n2 | blocking | pass | 15ms vs 49ms | fixed |
| n3 | date | pass | 22ms vs 69ms | fixed |

Gate: fixed 12 (s9, s5, s28, s29, s17, s25, s8, b9, b10, b11, n2, n3), broken 0, latency 0, leaked 0.


## Prompt cache

The instruction text is unchanged. Sections 1–11 are the static block and do not include the manager's name, salon, or today. Those three facts follow `---DYNAMIC---`. `call-claude.ts` puts `cache_control: { type: "ephemeral" }` on the static block only. The reply model is mocked, so the token counts are the local replay's cache log and the latency is time-to-first-token for the whole prompt (OLD) against the dynamic tail (NEW).

- 1st call usage.cache_creation_input_tokens: 2781
- later calls with usage.cache_read_input_tokens > 0: 1
- first-token latency OLD: 0.14ms
- first-token latency NEW: 0.002ms
- replay pass/fail: unchanged
