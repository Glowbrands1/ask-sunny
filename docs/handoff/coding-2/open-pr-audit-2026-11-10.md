# Open-PR audit, 10 Nov 2026 (coding 2 for QA; nothing closed or merged)

Base: Sunny main ed18d1fc (QA round 15), Bubbles main c8c84093 (QA round 14). "On main" means the PR head is an ancestor of
main, or the flag the PR adds is defined in main's chat-quality-flags.ts. "Prod" is main's production-flags.json.
Scope: PRs older than 9 Nov 12:00Z (plus #647/#723/#726/#727, named or chained). Today's 10 Nov queue is left out.

## Ask Sunny

| PR | What it fixes | On main | Flag on | Recommendation |
|---|---|---|---|---|
| 727, 726, 723 | MADE_ABOUT_READER_ACCOUNT / _POLICY_LINE / _UNDATED_TOGETHER chain | yes (head in main) | UNDATED_TOGETHER on (round 15); the others off | close as superseded |
| 704 | EXIT_LETTER_SIGNER server-ask call | yes (head in main) | per flag file | close as superseded |
| 680 | UNKNOWN_NAME_ASK server-ask call | yes (head in main) | per flag file | close as superseded |
| 665 | TWO_FORMS_EACH_PERSON title-case offer | yes (head in main) | per flag file | close as superseded |
| 660 | LIST_POLICY_IS_EDIT | yes (head in main) | per flag file | close as superseded |
| 672 | STEP_B_DATE_SAID (+FORM_DATE_SAID_SETTLES) | yes (flags defined) | both on | close as superseded |
| 658 | [PARKED] STEP_B_MAKE_IT_ABOUT_ACCOUNT | yes (flag defined) | on | close as superseded |
| 675 | NEAR_MISS_QUESTION_RULES | no; carried into #741 | off | close as superseded by #741 |
| 532 | production-flags: FORM_NAME + CA_SALES on | no | FORM_NAME off | close (superseded by #741's list; FORM_NAME alone fails form-name-companions) |
| 559 | pk-1102 fixture (fails only with FORM_NAME on) | no | — | close: #741's ON pack is green without it |
| 515 | replay pack unwraps a streamed reply | yes (main's pack unwraps) | — | close as superseded |
| 332 | variation report | yes (support/variation-report on main) | — | close as superseded |
| 310 | FORM_DATE_INCIDENT_ONLY on the card path | yes (flag defined) | off | close as superseded |
| 696 | parity log: EXIT_ANSWER_NOT_A_CORRECTION Sunny-only | no (docs) | — | gate and ship (docs only) |
| 662 | STEP_B_ADD_UNDER_OBSERVED / _SECTION_SPACING / _REPLY_KEEPS_LINES | no | unset | gate and ship (merge main: 274 behind) |
| 593 | DRAFT_REUSE_OWN_ONLY | no | unset | gate and ship (608 behind) |
| 592 | DIFFERENT_EMPLOYEE_NEW_FORM (stacked on #577) | no | unset | needs rework: check against #738 SAME_REQUEST_OTHER_PERSON |
| 577 | SAME_FORM_OTHER_PERSON | no | unset | needs rework: overlaps #738 ("do the same thing for B") |
| 576 | SWITCH_NOT_FOR_ANOTHER_PERSON | no | unset | needs rework: overlaps #738 ("also make a coaching form for B") |
| 589 | CA_REASON_DUE_TO (port of B#501) | no | unset | gate and ship, with B#501 |
| 585 | NEGATED_LATENESS_TOPIC (rebuild of #304) | no | unset | gate and ship, with B#500 |
| 587, 584 | replay guards only (sibling items, "not needed here") | no (test only) | — | gate and ship (test only) |
| 568 | FORM_EDIT_SOURCE_TURN | no | unset | gate and ship, with B#480 |
| 552 | flag-classify FLAG_CLASSIFY_OFF (harness) | no | — | gate and ship, or close if the harness has moved on |
| 551 | ANIMAL_VISITORS_ONLY_WHEN_VISITOR | no | unset | gate and ship, with B#464 |
| 546 | sf-s15 Care and Cleaning case + pack manual section | partly (POLICY_CLEANING_INCIDENT defined) | unset | gate and ship (case only) |
| 545 | DESCRIBED_TOPIC_IS_ACCOUNT | no | unset | gate and ship, with B#457 |
| 544 | Pau's sf-s21…s25 / sf-b6 batch (9 flags, 22 commits) | no | all unset | needs rework (623 behind; split per flag) |
| 456, 436, 352, 348, 308, 306, 304, 303, 301, 300, 298, 296, 295, 294, 293, 292, 291, 290, 289, 288, 287, 286, 285, 283, 282, 281, 279, 276, 275, 274, 273, 272, 271, 270, 269, 268, 267, 266, 265, 264, 263, 262, 260, 257, 256, 255, 254, 253, 252, 251, 250, 249, 248, 247, 245, 244, 242 | the 26 Oct – 3 Nov backlog (one flag each: e.g. POLICY_SET_ASIDE, NAME_RESPELL, BARE_ANSWER_BINDING, EXIT_NOTICE_FULFILLED, BRAND_REPLY_GUARD, CHAT_UPSTREAM_RETRY …; #436 /about + /privacy; #267 T9 docs; #265 EPP lock) | no: none of their flags is defined on main (except #255 PRIOR_ACTIONS_PARSE, on; its NO_COMMA part is not) | all unset | close as stale: each branch tree is old (a diff to main deletes ~115,000 lines); re-raise only a report the replay pack still shows open |

## Ask Bubbles

| PR | What it fixes | On main | Flag on | Recommendation |
|---|---|---|---|---|
| 636 | EXIT_LETTER_ADDRESSEE port | yes (head in main) | per flag file | close as superseded |
| 630 | letter-signer server-ask call | yes (head in main) | per flag file | close as superseded |
| 618 | POLITE_ABOUT_STAYS_CARD call | yes (head in main) | per flag file | close as superseded |
| 598 | COACHING_CARD_POLICY call | yes (head in main) | per flag file | close as superseded |
| 595 | STEP_B_DATE_SAID | yes (head in main) | per flag file | close as superseded |
| 578, 572, 569 | TAKE_OFF_STAYS_CARD, STEP_B_MAKE_IT_ABOUT_ACCOUNT, PROPOSAL_POLICY_SET_ASIDE | yes (heads in main) | per flag file | close as superseded |
| 647 | MADE_ABOUT_UNDATED_TOGETHER port | **no** (1 commit; its base is on main) | unset here; **on in Sunny (round 15)** | gate and ship (retarget to main) |
| 649 (named by QA) | parity doc | not in this listing (closed or merged) | — | — |
| 458 | REQUEST_KEPT_IN_WINDOW | yes (flag defined) | on | close as superseded |
| 456 | POLICY_CLEANING_INCIDENT port | yes (flag defined) | unset | close as superseded |
| 432 | replay pack unwraps a streamed reply | yes (main's pack unwraps) | — | close as superseded |
| 454 | CA_SALES "CA for <A> due to …" (no own flag) | no; rebuilt as #501 | — | close as superseded by #501 |
| 453 | CA_SALES "write me a performace ca for …" (no own flag) | no | under CA_SALES, which is on | needs rework: it would act in production with no flag of its own |
| 591 | CARD_NAME_THEN_WORDS_CURRENT (sf-s38 3') | no | unset | needs rework: check against ACCOUNT_VERB_NOT_A_NAME (on), which holds the s38 rows |
| 585, 476, 444 | gate docs / flag classification records | no (docs) | — | gate and ship (docs) or close as historical |
| 506 | DIFFERENT_EMPLOYEE_NEW_FORM | no | unset | needs rework: check against #662 SAME_REQUEST_OTHER_PERSON |
| 490, 489 | SAME_FORM_OTHER_PERSON, SWITCH_NOT_FOR_ANOTHER_PERSON | no | unset | needs rework: overlap #662 |
| 504 | FULL_POSITION_TITLE (+TITLE_ENDS_AT_LINE, on) | partly | FULL_POSITION_TITLE unset | gate and ship |
| 503, 501, 500, 480, 464, 457 | DRAFT_REUSE_OWN_ONLY, CA_REASON_DUE_TO, NEGATED_LATENESS_TOPIC, FORM_EDIT_SOURCE_TURN, ANIMAL_VISITORS_ONLY_WHEN_VISITOR, DESCRIBED_TOPIC_IS_ACCOUNT | no | unset | gate and ship (each ~595–615 behind main; merge main first), with its Sunny twin |
| 471 | pk-1102 fixture | no | — | close: #665's ON pack is green without it |
| 455 | Pau's sf-b6 + Sunny sf-s21…s25 ports (6 flags, 13 commits) | no | all unset | needs rework (split per flag) |
| 272, 257, 240, 239, 237, 236, 235, 234, 233, 231, 230, 229, 228, 227, 225, 224, 223, 222, 221, 220, 219, 218, 217, 214, 213, 212, 210, 207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196, 195, 194, 192, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 177, 175, 174, 173, 172 | the 26–27 Oct backlog (twins of Sunny's) | no, except #229 COACHING_ASKS_WHAT_HAPPENED and #187 PRIOR_ACTIONS_PARSE (defined) | unset (PRIOR_ACTIONS_PARSE on) | close as stale (old trees: a diff to main deletes ~110,000 lines); #229, #187 close as superseded |
