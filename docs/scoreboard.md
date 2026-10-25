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
| s11 | Corena Schardt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 111ms | PASS 460ms |
| s5 | Nadia Brook · loc-0468 · 2026-10-23 · — | PASS 65ms | PASS 438ms |
| s27 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 211ms | PASS 654ms |
| s28 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 33ms | PASS 117ms |
| s29 | Elin Haskett · loc-0313 · — · — | PASS 18ms | PASS 68ms |
| s17 | Dora Lee · — · 2026-10-23 · — | PASS 63ms | PASS 369ms |
| s20 | — · — · — · — | PASS 32ms | PASS 341ms |
| s21 | Sloane Wexford · loc-0410 · 2026-10-05 · — | PASS 138ms | PASS 409ms |
| s25 | Dasiley Veklo · loc-0313 · — · — | PASS 32ms | PASS 145ms |
| s8 | Evangeline Pembury · loc-0463 · — · — | PASS 106ms | PASS 1082ms |
| s12 | Corena Schardt · loc-0462 · — · — | PASS 22ms | PASS 155ms |
| s16 | Marnie Kettering · loc-0309 · — · — | PASS 18ms | PASS 180ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 46ms | PASS 346ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 129ms | PASS 606ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 83ms |
| b12 | Odette Brannock · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 108ms | PASS 792ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 29ms | PASS 215ms |
| n2 | Corena Shardt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 9ms | PASS 48ms |
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
| s11 | Corena Schardt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 97ms | PASS 457ms |
| s5 | Nadia Brook · loc-0468 · 2026-10-23 · — | PASS 61ms | PASS 433ms |
| s27 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 210ms | PASS 635ms |
| s28 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 32ms | PASS 115ms |
| s29 | Elin Haskett · loc-0313 · — · — | PASS 19ms | PASS 66ms |
| s17 | Dora Lee · — · 2026-10-23 · — | PASS 63ms | PASS 358ms |
| s20 | — · — · — · — | PASS 32ms | PASS 343ms |
| s21 | Sloane Wexford · loc-0410 · 2026-10-05 · — | PASS 118ms | PASS 401ms |
| s25 | Dasiley Veklo · loc-0313 · — · — | PASS 31ms | PASS 143ms |
| s8 | Evangeline Pembury · loc-0463 · — · — | PASS 106ms | PASS 1127ms |
| s12 | Corena Schardt · loc-0462 · — · — | PASS 22ms | PASS 195ms |
| s16 | Marnie Kettering · loc-0309 · — · — | PASS 18ms | PASS 182ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 47ms | PASS 347ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 129ms | PASS 603ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 15ms | PASS 84ms |
| b12 | Odette Brannock · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 103ms | PASS 772ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 28ms | PASS 210ms |
| n2 | Corena Shardt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 9ms | PASS 49ms |
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

- replay_set.json sha256: `2d5654a83952a84a9e21e3e19185bf253b9a776c7fa3f8c8ba2da518954d1fde`
- prompts.ts sha256: `df5d07eb04132cde54c952ac0ae10bbee012e638f6006903a6b426885d4bb709`
- prompts.ts sha256, printed-page citation rule: `8878c96230502f9a6eaed04ee2bf215a6ce1c55fdbc2d9249189ef8f01c27b4c`
- prompts.ts sha256, cross-chat reply rule (CROSS_CHAT_REPLY_GUARD_ENABLED, off by default; flags-off prompt text unchanged): `e3e039dc61724e95b68a35f31748a7aae997d27be0d1c4751b1b55eb9dcae14a`
- prompts.ts sha256, retrieved-sources rule (retrieved sources are never "the sources you shared"): `14577433ba7a80bb1798e9335b94a29e6f691e36a2b3b94b20223e92be67456a`
- commit: `f4b261628145bc17059fa753a5bc22f96a06694e`
- model: `claude-opus-5`
- flag set: `INTENT_EXTRACTION_ENABLED, FEWSHOT_EXAMPLES_ENABLED, SELF_CHECK_ENABLED, QUERY_REWRITE_ENABLED, GROUNDED_ENTITIES_ENABLED, DRAFT_MERGE_ENABLED, ACTION_PLAN_SENTENCES_ENABLED, TYPED_NAME_PROCEEDS_ENABLED, ATTENDANCE_POLICY_CITATION_ENABLED, POLICY_PAGE_REQUIRED_ENABLED, MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED, POLICY_GATE_NONBLOCKING_ENABLED, MANUAL_SECTION_DEDUPE_ENABLED, PRINTED_PAGE_CITATION_ENABLED, PAYROLL_AMOUNT_FIELD_ENABLED, CODE_SLOTS_ENABLED, GLOBAL_SALON_ASK_ENABLED`
- runs: 1
- latency gate: 20000 ms
- numbers: case milliseconds are measured on the mocked reply. The structural round uses CPU time scaled to the reference loop. Cache token counts are a local estimate, not Anthropic usage.
- last-known-good prompt commit: `417e80c12d7275681411606f87af851fb080b348`
- last-known-good prompts.ts sha256: `0c6b9f2efdbdc054d3f7832f5002e92c844a5b95e72622e096328ac2c2ee218d`
- built prompt sha256, current: `197179a11043b54f944b776a3f8bd19ad241373881863ca6f7f8b314d5a5f671`
- built prompt sha256, last-known-good: `c1edfc7f89cc1bc024af1a9342ed8f80ce2c80191065b8efef65f40d16eb029e`
- prompt text differs: yes
- prompt revert: none

| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |
| --- | --- | --- | --- | --- |
| s4 | Test Testy · loc-0462 · 2026-09-20 · Late Opening p.15 | PASS 67ms | PASS 428ms | PASS 239ms |
| s9 | Ima · loc-0462 · 2026-09-28 · Late Opening p.15 | PASS 43ms | PASS 78ms | PASS 71ms |
| s11 | Corena Schardt · loc-0468 · 2026-09-29 · Cell Phone/Smart Watch Policy p.19 | PASS 34ms | PASS 83ms | PASS 71ms |
| s5 | Nadia Brook · loc-0468 · 2026-10-23 · — | PASS 21ms | PASS 79ms | PASS 38ms |
| s27 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 65ms | PASS 127ms | PASS 112ms |
| s28 | Elin Haskett · loc-0313 · — · Standards of Conduct p.12 | PASS 11ms | PASS 23ms | PASS 20ms |
| s29 | Elin Haskett · loc-0313 · — · — | PASS 4ms | PASS 8ms | PASS 6ms |
| s17 | Dora Lee · — · 2026-10-23 · — | PASS 19ms | PASS 82ms | PASS 77ms |
| s20 | — · — · — · — | PASS 10ms | PASS 64ms | PASS 46ms |
| s21 | Sloane Wexford · loc-0410 · 2026-10-05 · — | PASS 31ms | PASS 59ms | PASS 46ms |
| s25 | Dasiley Veklo · loc-0313 · — · — | PASS 8ms | PASS 18ms | PASS 14ms |
| s8 | Evangeline Pembury · loc-0463 · — · — | PASS 36ms | PASS 188ms | PASS 169ms |
| s12 | Corena Schardt · loc-0462 · — · — | PASS 8ms | PASS 22ms | PASS 16ms |
| s16 | Marnie Kettering · loc-0309 · — · — | PASS 5ms | PASS 24ms | PASS 19ms |
| b9 | Test Employee · — · 2026-10-15 · Standards of Conduct p.12 | PASS 15ms | PASS 83ms | PASS 96ms |
| b10 | Testy Testerson · loc-0903 · 2026-10-16 · Standards of Conduct p.12 | PASS 40ms | PASS 135ms | PASS 96ms |
| b11 | Testy Testerson · loc-0903 · 2026-10-20 · Attendance p.14 | PASS 5ms | PASS 21ms | PASS 21ms |
| b12 | Odette Brannock · — · 2026-10-22 · Animals in the Workplace p.30 | PASS 29ms | PASS 197ms | PASS 162ms |
| n1 | Test Employee · loc-0462 · — · — | PASS 9ms | PASS 26ms | PASS 22ms |
| n2 | Corena Shardt · loc-0462 · 2026-09-29 · Attendance p.14 | PASS 4ms | PASS 11ms | PASS 9ms |
| n3 | TT · — · 2026-10-23 · — | PASS 2ms | PASS 11ms | PASS 9ms |
| g1 | Sarah Test · loc-0462 · — · — | PASS 5ms | PASS 12ms | PASS 11ms |
| g2 | Sarah Test · loc-0462 · — · — | PASS 9ms | PASS 16ms | PASS 16ms |
| g3 | Sarah Test · loc-0903 · — · — | PASS 7ms | PASS 24ms | PASS 21ms |
| g4 | Sarah Test · loc-0462 · — · — | PASS 6ms | PASS 20ms | PASS 21ms |
| g5 | Sarah Test · — · — · — | PASS 9ms | PASS 36ms | PASS 34ms |
| g6 | Sarah Test · — · — · — | PASS 7ms | PASS 23ms | PASS 22ms |
| g7 | Sarah Test · loc-0903 · — · — | PASS 6ms | PASS 19ms | PASS 19ms |

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
| INTENT_EXTRACTION_ENABLED | 27/28 | 24/28 | s17 | s17, s25, n2, g4 |
| FEWSHOT_EXAMPLES_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| SELF_CHECK_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| QUERY_REWRITE_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| GROUNDED_ENTITIES_ENABLED | 27/28 | 21/28 | s17 | s9, s17, s25, b9, b10, b12, n2 |
| DRAFT_MERGE_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| ACTION_PLAN_SENTENCES_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| TYPED_NAME_PROCEEDS_ENABLED | 28/28 | 10/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, s25, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| ATTENDANCE_POLICY_CITATION_ENABLED | 28/28 | 16/28 | — | s9, s5, s28, s29, s17, b10, b11, n2, n3, g3, g4, g7 |
| POLICY_PAGE_REQUIRED_ENABLED | 28/28 | 16/28 | — | s9, s5, s28, s29, s17, b10, b11, n2, n3, g3, g4, g7 |
| MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| POLICY_GATE_NONBLOCKING_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| MANUAL_SECTION_DEDUPE_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| PRINTED_PAGE_CITATION_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| PAYROLL_AMOUNT_FIELD_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| CODE_SLOTS_ENABLED | 27/28 | 11/28 | s17 | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |
| GLOBAL_SALON_ASK_ENABLED | 28/28 | 13/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g7 |
| CHAT_DATA_TOOLS_ENABLED | 28/28 | 11/28 | — | s4, s9, s11, s5, s27, s28, s29, s17, b9, b10, b11, b12, n2, n3, g3, g4, g7 |

Safe order for Pau: turn these on from the top. A flag with no floor break holds the flags-off checks on its own. A date note means the only floor miss is s17: the flag stores 2026-10-23, which the old floor leaves blank and the card criteria requires. Round 3 with every flag on passes all 28.

1. `INTENT_EXTRACTION_ENABLED` — card 24/28 — stores s17's date
2. `GROUNDED_ENTITIES_ENABLED` — card 21/28 — stores s17's date
3. `ATTENDANCE_POLICY_CITATION_ENABLED` — card 16/28
4. `POLICY_PAGE_REQUIRED_ENABLED` — card 16/28
5. `GLOBAL_SALON_ASK_ENABLED` — card 13/28
6. `ACTION_PLAN_SENTENCES_ENABLED` — card 11/28
7. `CHAT_DATA_TOOLS_ENABLED` — card 11/28
8. `CODE_SLOTS_ENABLED` — card 11/28 — stores s17's date
9. `DRAFT_MERGE_ENABLED` — card 11/28
10. `FEWSHOT_EXAMPLES_ENABLED` — card 11/28
11. `MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED` — card 11/28
12. `MANUAL_SECTION_DEDUPE_ENABLED` — card 11/28
13. `PAYROLL_AMOUNT_FIELD_ENABLED` — card 11/28
14. `POLICY_GATE_NONBLOCKING_ENABLED` — card 11/28
15. `PRINTED_PAGE_CITATION_ENABLED` — card 11/28
16. `QUERY_REWRITE_ENABLED` — card 11/28
17. `SELF_CHECK_ENABLED` — card 11/28
18. `TYPED_NAME_PROCEEDS_ENABLED` — card 10/28

`CHAT_DATA_TOOLS_ENABLED` is also scored on s22 and s23. The turns are verbatim. The reply model is mocked, so a data case passes when the flag attaches the block the answer was missing. The review read in this harness is the page inventory the earlier miss named, 254 reviews. The chooser is stubbed the same way the other tools are, because the model is mocked.

| Case | Flag off | Flag on |
| --- | --- | --- |
| s22 | miss | miss |
| s23 | miss | pass |

s22 is miss with the flag on and miss with it off. Both turns say "change my password", and the help text is attached only for a reset, a forgotten password, or a sign-in failure. s23 passes with the flag on and misses with it off. The flag attaches "The Google Reviews page holds 254 reviews in total". The other 21 cases hold the floor.


## Rulebook — old behaviour against guide v3

OLD is `origin/main` as-is, flags off, the same turns and the same mocked reply. NEW is this branch with the rulebook flags on. The guide was not pasted over the system prompt. Each case runs 1 time. A rule misses if any run misses it. A rule that does not apply to the case is not scored. Worse means NEW misses a rule OLD passed, and that case is fixed before this pull request is ready.

- OLD commit: `b9ae362fd80e1fc492c4326f80834cf105ef19b8`
- NEW commit: `f4b261628145bc17059fa753a5bc22f96a06694e`
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

One round, one commit. SELF_CHECK stays off. Judged rules are the structural ones: employee on the card, typed name kept, salon does not gate the card, date slot, no blocking question, no leaked text. Before is flags off. After is this flag set. Latency is measured CPU time of the run, scaled to the reference loop so a slower machine does not change the gate. It regresses when it is more than 25% slower than flags off and also more than 250ms slower. The reply model is mocked.

- commit: `f4b261628145bc17059fa753a5bc22f96a06694e`
- harness: local
- flag set: `INTENT_EXTRACTION_ENABLED=1 GROUNDED_ENTITIES_ENABLED=1 DRAFT_MERGE_ENABLED=1 TYPED_NAME_PROCEEDS_ENABLED=1 CODE_SLOTS_ENABLED=1 GLOBAL_SALON_ASK_ENABLED=1 SELF_CHECK_ENABLED=false`
- SELF_CHECK_ENABLED=false
- SELF_CHECK: off
- runs: 1
- accepted: yes

| Case | Before | After | Latency | Round |
| --- | --- | --- | --- | --- |
| s4 | pass | pass | 97ms vs 61ms | held |
| s9 | date | pass | 55ms vs 39ms | fixed |
| s11 | pass | pass | 58ms vs 28ms | held |
| s5 | date | pass | 34ms vs 18ms | fixed |
| s27 | pass | pass | 94ms vs 65ms | held |
| s28 | salon | pass | 15ms vs 10ms | fixed |
| s29 | salon | pass | 5ms vs 3ms | fixed |
| s17 | date | pass | 80ms vs 17ms | fixed |
| s20 | pass | pass | 40ms vs 9ms | held |
| s21 | pass | pass | 38ms vs 25ms | held |
| s25 | blocking | pass | 12ms vs 7ms | fixed |
| s8 | blocking | pass | 153ms vs 31ms | fixed |
| s12 | pass | pass | 16ms vs 7ms | held |
| s16 | pass | pass | 16ms vs 5ms | held |
| b9 | blocking | pass | 88ms vs 15ms | fixed |
| b10 | employee, typed, salon, date | pass | 77ms vs 34ms | fixed |
| b11 | employee, typed, salon | pass | 17ms vs 5ms | fixed |
| b12 | pass | pass | 143ms vs 24ms | held |
| n1 | pass | pass | 27ms vs 8ms | held |
| n2 | blocking | pass | 7ms vs 3ms | fixed |
| n3 | date | pass | 10ms vs 2ms | fixed |
| g1 | pass | pass | 9ms vs 4ms | held |
| g2 | pass | pass | 13ms vs 7ms | held |
| g3 | salon | pass | 19ms vs 6ms | fixed |
| g4 | salon | pass | 19ms vs 5ms | fixed |
| g5 | pass | pass | 32ms vs 12ms | held |
| g6 | pass | pass | 20ms vs 6ms | held |
| g7 | salon | pass | 17ms vs 7ms | fixed |

Gate: fixed 15 (s9, s5, s28, s29, s17, s25, s8, b9, b10, b11, n2, n3, g3, g4, g7), broken 0, latency 0, leaked 0.


## Prompt cache

Mocked, not measured from Anthropic. PROMPT_CACHE_ENABLED is off in this replay, so the built prompt matches main and does not contain a `---DYNAMIC---` marker. The lines below are the local estimator in prompt-cache.ts (characters divided by 4), not usage.cache_creation_input_tokens from a live call. The first-token figures are that same local stand-in. When the flag is on, the marker splits the prompt and per-request data stays after it.

- 1st call usage.cache_creation_input_tokens: 2800
- later calls with usage.cache_read_input_tokens > 0: 2
- first-token latency OLD: 0ms
- first-token latency NEW: 0ms
- replay pass/fail: unchanged
