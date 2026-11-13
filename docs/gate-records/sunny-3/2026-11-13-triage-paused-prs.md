# Gate-Sunny-3 — triage of the paused Sunny PRs vs main 7dc8f51c (report only, no merges)

Method:
- PR heads fetched 13 Nov ~19:30Z; all 11 are **open**.
- Mergeability: `git merge-tree` against origin/main 7dc8f51c.
- "Still needed": each PR's own new replay case files copied onto a clean main 7dc8f51c and run with main's production
  flags. An OPEN arm that still fails there means the case is still open, so the PR is needed; one that passes would
  already hold on main. Fix arms were ignored (their flags don't exist on main).

| PR | flag(s) | head | still needed? | conflict vs main | gate status | risk | order |
|---|---|---|---|---|---|---|---|
| #909 | PAYROLL_AMOUNT_AFTER_PAYROLL | c03285037 | **yes**: `nov12-payroll-amount-after-payroll` still open | flag lists only (chat-quality-flags, flags-off-parity) | GO (12 Nov) | low | **1** (live bug) |
| #894 | CARD_PLAN_MATCHES_CREATE | 63aa44424 | **yes**: 17l card-plan ×2 open; missed-shift guard holds | **route.ts** + flag lists | GO (eba76b238 + delta 63aa44424) | medium (route.ts, overlaps #914) | **2** (live 17l) |
| #914 | REOPEN_IS_OPENING, BARE_FORM_NAME_ASKS_WHAT, CA_NO_POLICY_ASKS_WHICH, PASTED_REVIEW_ASKS_WHAT_YOU_SAW | 9ae3eb0ec | **yes**: 4 of 5 open (2, 4a, 4b, 4c); 3 is a guard and holds | **route.ts** | not gated | medium-high (4 flags; overlaps #894 route.ts, #872/#910 ca-policy.ts) | **3** (live 17n), gate after #894 lands |
| #872 | WORN_CLOTHING_IS_DRESS_CODE, COPY_PASTE_POINTS_TO_CARD | 889163e8e | **yes**: 17i hoodie and copy-paste both open | **ca-policy.ts** + flag lists; 161 behind | not gated | medium (ca-policy.ts; overlaps #910 card-meta-turn, #914) | **4** (live 17i) |
| #910 | TERSE_REQUEST_ACCOUNT, CREATE_POINTS_TO_SHOWN_CARD | 7fac87e9a | **yes**: all 6 OPEN arms open (terse ×2, create-points ×4) | flags-off-parity only | not gated | medium (overlaps #872 card-meta-turn.ts + ca-policy.ts) | **5**, after #872 (same files) |
| #912 | APPROVER_TITLE_NOT_EMPLOYEE | fdcf802a8 | **yes**: r37 dm-approves open; stated-title guard holds | flag lists only | not gated | low | **6** |
| #867 | TITLE_BEFORE_NAME, TITLE_BEFORE_NAME_REPLY_LINES | f449c635a | **yes**: 3 open; plain-name guard holds | flag lists only; 161 behind | not gated | low-medium (name reading) | **7** |
| #899 | STEP_B_ADD_UNDER_OBSERVED, STEP_B_REPLY_KEEPS_LINES (+ STEP_B_SECTION_SPACING again) | 76792c07c | **yes**: 6 open | **form-write.ts, outline-sections.ts (+test)**; 170 behind | not gated | medium-high: it re-carries SECTION_SPACING, which is live since round 37 (#882); the rebase must keep main's version | **8** (live Step B) |
| #905 | NEXT_PUBLIC_REPLY_QUOTE_LINES | 4316bffbf | client renderer; no replay case (DOM tests) | flag lists only | GO (12 Nov) | low | **9** (any time) |
| #904 | TERMINATION_CARD_TIDY | a794cf714 | latent only: the plan is the card's last line today, so replay was byte-identical | flag lists only | GO (12 Nov) | low | **10** (optional) |
| #662 | same as #899 | 085e027c0 | **superseded**: #899 contains every #662 commit | same as #899 | — | — | **close** in favour of #899 |

Overlaps (product files changed by more than one PR):
- #894 × #914: `app/api/chat/route.ts`
- #872 × #910: `ai/card-meta-turn.ts`, `forms/ca-policy.ts`
- #872 × #914 and #910 × #914: `forms/ca-policy.ts`
- #662 × #899: form-write.ts, outline-sections.ts, form-diff-reply.ts (#899 ⊃ #662)
- #899 vs main: both hold STEP_B_SECTION_SPACING (#882).

Notes:
- Each case listed as "open" still fails on main 7dc8f51c with production flags (including CLOSE_SPELLING_MATCH and
  38d), so none of these PRs is made redundant by what shipped.
- The GO verdicts for #909/#894/#905/#904 were on older bases (7e8dcdb6 / 0bbf). After each rebase, a test-only
  check plus a 1 OFF + 1 ON on the new main is advisable, quick for #905/#904 and fuller for #894 because of route.ts.
