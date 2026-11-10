# Unreleased flags triage (Ask Sunny, audit item 18, 10 Nov 2026)

QA's audit item 18: every `*_ENABLED` flag the code reads that is not in any list of
`src/config/production-flags.json` (`on`, `assumedOn`, `off`). Computed on `main` **ccfbe214**:
every `*_ENABLED` name read in non-test `src/**/*.ts(x)` (replay pack excluded), minus every list in
that file. The audit's list had 48 names; the recomputation finds **50**. The two extra are read through
a named constant rather than a string literal at the call site, which is likely why the first pass
missed them: `NEW_HIRE_INVITES_ENABLED` (`employees/woven/access/new-hire.ts`) and
`FORMS_TEMPLATE_SYNC_ENABLED` (`forms/template-sync-policy.ts`). None of the 48 was extra.

By that file's own rule these are not set on in production (QA's 5 Nov read of every `*_ENABLED`
variable, 0 mismatches). Origins are the oldest commit that adds the name (`git log -S`; the clone was
deepened to full history to read them), given as the PR number when the squash or merge names one,
else the short sha. Replay cases are those whose `fixFlags` hold the flag.

**Counts (50):** (R) release candidate 12 · (X) retire 8 · (K) keep off on purpose 30 · (?) undecided 0 (after QA's rulings of 10 Nov 2026: the two form-edit flags K, revisit after the queue; the two invite flags K, only one ever ships; the other 13 "?" rows resolved the same day from code, tests, replay cases and history. POLICY_GATE_NONBLOCKING and its twin were flipped on in round 24 after this list was computed, so they count as R, released).

Nothing is changed here: no flag is flipped, deleted or renamed, and no code is touched. The two
`NEXT_PUBLIC_` client twins whose server flags are in `off` (REMAP_DRAFT_SOURCES, SEND_AFTER_HYDRATE)
belong in `off` beside them; the file is left for QA to update.

| Flag | What it does | Origin | Verdict | Evidence / replaced by / why |
| --- | --- | --- | --- | --- |
| CHAT_IMPORT_PROVEN_OWN_ENABLED | Importing a chat this account does not hold must prove every answered turn is this account's | #419 | R | Independent security review, 31 Oct (parity-log.md); no replay case (chat store, not the chat route) |
| CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED | "Create a form from this conversation" with a card open is a create command, not a repeat of the card | 32b65769 | R | QA's P6, live 10 Nov; replay `nov10-create-from-conversation-*` (open); on in the sibling's production (round 16b) |
| DRAFT_ACTIONS_ENABLED | "Delete that draft" and "same incident" answered in chat | #200 | R | Live: QA F8 (conv 21 and 22 Oct): "delete that draft" and "same incideny" still fail with it off (no other path; `chat/route.ts`); test `qa-f8-draft-actions-e2e`; no replay case |
| FRAMEWORK_GENERAL_SECTIONS_ENABLED | Answer from the coaching framework's general sections when no section names the issue | #228 (orig. #212) | R | oct-pr-triage.md #212 class (a*): fixed on main only behind this flag; no replay case |
| FULL_POSITION_TITLE_ENABLED | A title starting the line under the employee's name is the employee's ("… Weekends Only") | 4dbf6de3 (guard cases 209c62ca) | R | QA ruled the blank Job Title a regression of TITLE_ENDS_AT_LINE (ON); replay `nov6-coding3-full-position-title-negative` (open) |
| NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED | Client twin of POLICY_GATE_NONBLOCKING | #160 | R | Released with POLICY_GATE_NONBLOCKING in round 24 (cc95a871, #807); now in `on` |
| OBSERVATION_OWN_PERSON_ONLY_ENABLED | The Observation never keeps other people's names or the manager's command to the app | 3a5a30c1 | R | QA's P7, live 10 Nov; replay `nov10-observation-own-person-p7` (open) |
| ONE_CARD_ONE_PAGE_ENABLED | The card's citation line takes the page the card already gives that section | 8a756174 (#717) | R | Two pages for one section on a live CA card (round 9); `_about`: "held for its own round"; replay `nov9-one-card-one-page-coaching` (open) |
| POLICY_GATE_NONBLOCKING_ENABLED | A blank Direct policy does not block the card or finalize | #160 | R | Released after this list (ccfbe214): QA round 24 put it in `on` (cc95a871, #807, blank-policy marker); replay `nov10-blank-direct-policy-never-called-verified` |
| REFORMAT_KEEPS_SOURCES_ENABLED | A reformat turn keeps the earlier answer's sources; marker removal leaves no dangling words | #228 (orig. #212) | R | oct-pr-triage.md #212 class (a*): `stripMarkers("[S6][S2]:")` still keeps "[S6]" with production flags; no replay case |
| RESIGN_METHOD_FOLLOWUP_ENABLED | "She told me verbally" / "verbal notice" fills How Employee Resigned as Verbal | #228 | R | The owner's decision of 25 Oct, never flipped; no replay case |
| TRUNCATION_RETRY_BUDGET_ENABLED | No truncation retry after a first attempt over 50 s, so a turn stays under the 120 s ceiling | #433 | R | QA live: a 67 s turn (31 s + 36 s retry); TRUNCATION_RETRY is ON; no replay case |
| CODE_SLOTS_ENABLED | Employee, salon, date, page decided in code, not by the model | #160 | X | Replaced by the INTENT_EXTRACTION + GROUNDED_ENTITIES path (ON) every later slot fix is built on; on, it bypasses LATE_OPEN_DATE / FORM_DATE_SAID_SETTLES date readers (ON) (`intent-slots.ts` date slot); round 1 s17 floor break |
| CONVERSATION_DRAFT_REUSE_ENABLED | One draft per form per conversation | #179 | X | Replaced by the any-chat open-incident reuse (unconditional) narrowed by DRAFT_REUSE_SAME_CHAT_ONLY + DRAFT_REUSE_OWN_ONLY (ON) (`forms/instances/route.ts`); its own path reused an old draft for a new request (#456) |
| CONVERSATION_PROPOSAL_DEDUPE_ENABLED | A second create of the same proposal returns its draft | #160 | X | Replaced by the unconditional one-draft-per-card lookup (`findRecentAssistantDraft`, QA 22 Oct; same `proposalId` returns its draft); test `duplicate-create-route.test.ts` |
| NEWEST_PLACE_TURN_ENABLED | The salon the newest manager turn names is the card's salon | #228 (orig. #213) | X | oct-pr-triage.md #213 class (a): holds with production flags; fixed by another path (PLACE_FROM_CUE / PLACE_SPAN_GUARD era, not pinned) |
| OBSERVATION_WITHOUT_ASK_ENABLED | The manager's ask ("can i give a ca for …") is never the Observation | #540 | X | Replay `nov5-sf-s28-incident-from-previous-turn` is "fixed" with production flags: replaced by SALES_SHORTFALL_OBJECT, SALES_OBSERVATION_ACCOUNT, CA_PERFORMANCE_REASON (ON, round 5) |
| OMISSION_IS_ACCOUNT_ENABLED | A duty not done is an account, so "what happened?" is not asked | #540 | X | Same case and same replacement as OBSERVATION_WITHOUT_ASK (sf-s28) |
| POLICY_CHANGE_RELEVANT_ENABLED | A message whose only "policy" is the manual's name changes no policy | cac865e6 | X | parity-log/2026-11-08-policy-change-relevant.md: not needed here (NOT_A_SECTION covers it; both cases hold flag off). Shared code is on in the sibling app |
| POLICY_CLEANING_INCIDENT_ENABLED | Cleaning left undone cites Care and Cleaning (p.21) | #241 | X | Contradicts the owner's later ruling (cleaning undone is Other); replaced by CA_SALES_POLICY + CLEANING_OTHER_EVERY_WORDING (ON) |
| CA_OFFER_KEEPS_ACCOUNT_ENABLED | "Yes" to the CA offer keeps the manager's account, not the offer's rewritten request | #574 | K | Matters only on FORM_FULL_REMAP's card (off); flip with it (parity-log/2026-11-08-ca-offer-keeps-account.md); replay `nov5-coding3-ca-offer-yes-keeps-msb-account` |
| CHAT_DATA_TOOLS_ENABLED | Read-only review and sales data tools, and password-reset help, in chat | #135 | K | Data feature (with REPORT_BREAKDOWN); product decision; scoreboard: holds the floor, fixes s23 only |
| CHAT_LONG_MESSAGE_ENABLED | Chat messages up to 12,000 characters instead of 4,000 | #228 | K | Awaiting owner/QA count of 4,000-character 400s in production (no report found); flips with NEXT_PUBLIC twin |
| CHAT_MEMORY_ENABLED | Per-user memory tools and recalled-memory prompt block | #135 | K | Feature that stores user data; product/privacy decision; guard replay `nov10-memory-and-summary-writes` |
| CHAT_PARALLEL_REWRITE_ENABLED | Normalizer runs alongside intent extraction (speed) | #762 | K | `_about`: "CHAT_PARALLEL_REWRITE stays off" (speed step 1 shipped PARALLEL_LOADS alone); costs an extra Haiku call on some turns |
| CITATION_VERIFY_ENABLED | Drop a manual citation whose heading/page is not in the current manual | #160 | K | Awaiting QA replay/eval on vs off: no live report of an unverified heading (POLICY_CITATION, PRINTED_PAGE_CITATION ON); adds a manual read per turn |
| FORMS_TEMPLATE_SYNC_ENABLED | Local opt-in for a non-Vercel build to publish the template library | 258922c4 | K | Ops: never read on Vercel; local builds point at production's database, so opt-in must stay deliberate (missing from the audit's list) |
| FORM_EDIT_NOOP_GUARD_ENABLED | No false "Updated": a write that changes nothing is refused; reply from the saved diff | #511 | K | QA, 10 Nov 2026: K, revisit after the queue (Step B is live and stable; Steps 3–4 not scheduled). Step 4; flips with FORM_EDIT_TOOL_IN_STREAM. |
| FORM_EDIT_TOOL_IN_STREAM_ENABLED | `edit_form` tool offered in the main answering call | #504 | K | QA, 10 Nov 2026: K, revisit after the queue (Step B is live and stable; Steps 3–4 not scheduled). Step 3; classification: 2 regressions, both fixed. |
| FORM_REVISIONS_ENABLED | Finalized-form edits need a reason; Revised/Superseded marks, history, form page | #226 | K | Feature (Option B) awaiting decision; flips with NEXT_PUBLIC_FORM_REVISIONS (server refuses edits with no reason) |
| GOOGLE_REVIEWS_IN_CHAT_ENABLED | Review questions get the Reviews page's month-to-date figures | #258 | K | Integration feature; product decision |
| INVITE_LINK_HOLD_ENABLED | Invite link holds the token on GET; verifies only on the Continue POST (mail-scanner safe) | #373 | K | QA, 10 Nov 2026: K. Overlaps NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS (the same mail-scanner invite problem); only one of the two should ever ship. Needs the Supabase Invite template change. |
| MODEL_RETRY_ENABLED | 45 s model timeout, two retries, plain "busy" message | #160 | K | Worst case 3 × 45 s = 135 s + backoff > route `maxDuration` 120 s, so "busy" never reaches the manager; release only with a smaller budget (e.g. 35 s, 1 retry ≈ 70 s) |
| NAMED_FORM_EXACT_ENABLED | A form the manager named is kept only as itself | #228 | K | No live problem here: the live case (conv_mvnmetao241awxn) is fixed by FORM_CHOICE_STATED (ON) alone; the rest guards unpublished templates, which this app has none of; flip if one is hidden |
| NEAR_MISS_DETAILS_ACCEPT_ENABLED | Details after the near-miss name question accept the asked name | 8e1b3192 | K | Name set: acts only with FORM_NAME_FROM_ROSTER (off); replay `nov7-near-miss-details-*` runs with the name set |
| NEW_HIRE_INVITES_ENABLED | Hourly run sends new hires their access link one at a time | #369 | K | Ops switch, "built and off" with its own SINCE/ROLES/PER_HOUR settings; sends email (missing from the audit's list) |
| NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED | Client twin of CHAT_LONG_MESSAGE (composer limit) | #228 | K | Flips with CHAT_LONG_MESSAGE (awaiting the same count) |
| NEXT_PUBLIC_FORM_REVISIONS_ENABLED | Client twin of FORM_REVISIONS (shows the reason dialog) | #226 | K | Must flip with FORM_REVISIONS |
| NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS_ENABLED | A successful password sign-in also accepts a pending invitation | #372 | K | QA, 10 Nov 2026: K. Overlaps INVITE_LINK_HOLD; only one of the two should ever ship. |
| NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED | Client twin of REMAP_DRAFT_SOURCES (Create fills from card lines) | #231 | K | Server twin is in `off`; both act only with FORM_FULL_REMAP (off) |
| NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED | Client twin of SEND_AFTER_HYDRATE (queue sends until history loads) | #164 | K | Server twin is in `off` (QA, 5 Nov); flips with it |
| PRIVATE_CREATOR_FORMS_ENABLED | Forms by listed accounts are seen only by them and admin | #321 | K | Access config; needs PRIVATE_FORM_CREATOR_IDS set in Vercel; owner's call |
| REPORT_BREAKDOWN_ENABLED | Grouped Comp Report and Sales Totals breakdowns in chat | #135 | K | Read only inside CHAT_DATA_TOOLS (`chat-data-tools.ts`); flips with it |
| REQUIRED_FIELD_CHECK_ENABLED | The reply lists template fields not yet filled | #160 | K | Awaiting owner call on reply length: lists unfilled template fields on every reply; no report behind it (TEMPLATE_OUTLINE_FIELDS ON is a different ask) |
| ROSTER_COMPOUND_SURNAME_ENABLED | A two-word surname is compared word by word | e542451f | K | Name set (FORM_NAME_FROM_ROSTER off); `_about` P11a: "the rest of the roster set stays off" |
| ROSTER_NAME_IN_CANDIDATE_ENABLED | A candidate ending in a roster first name could be that person | #550 | K | Name set, as above; docs/flag-classification/ROSTER_NAME_IN_CANDIDATE_ENABLED.md |
| ROSTER_NEAR_MISS_ENABLED | A one-letter surname typo asks "Is this for <roster name>?" | #549 | K | Name set, as above; replay `nov5-r3-surname-one-letter-wrong` (open) |
| ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED | The not-on-roster note reads "employee, <Name>" and "for <Name>" at the end | d55179b8 | K | Name set, as above |
| UNIFIED_AUTHORITY_ORDER_ENABLED | Performance and daily-stats prompts share one order of authority | #160 | K | Awaiting QA eval run on vs off: prompt-only (performance and daily-stats blocks), no report behind it |
| WOVEN_KNOWLEDGE_SYNC_ENABLED | Woven knowledge sync (connector, manifest, schedule) | #55 | K | `_about`: left out on purpose (sensitive; value not read) |
