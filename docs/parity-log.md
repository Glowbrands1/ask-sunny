# Parity log: Ask Sunny ↔ Ask Bubbles

Ask Bubbles (`Glowbrands1/Ask-bubbles`) is a port of this app. Every fix to
chat, forms, Corrective Action, policy citation, access or sync is either
ported to the sibling or listed here as staying one-sided, with the reason.
See `CLAUDE.md`.

## 22 Oct 2026: both apps brought level (pending QA review)

Every chat/forms fix merged to either `main` from 12–21 Oct was compared. The
gaps below are closed on branch `claude/lucid-shannon-v79zju` in each repo,
**not yet merged to `main`** (QA hold, 22 Oct). Everything else already
existed in both.

### Ported into Ask Sunny from Ask Bubbles

| Bubbles commit | Fix |
|---|---|
| c32eb59 (+ Sunny's own unmerged 0090bef) | The open conversation stays in the address; a reload reopens it |
| fe871f1 | Confirm before deleting a conversation or finalizing a form |
| ab77b14 (+ Reviews/Videos from Sunny's unmerged c2a0e88) | Small links and buttons at least 24px to tap |
| 062e5dc | Browser autofill off on every typed form field |
| 987e4b7 | "Create a form" shown only to an account that may create one |
| 4cbb84c | "write a CA for X" read as a request; the CA leads when asked for |
| 8cdc41b | What an earlier coaching was for stays on the history line |
| ac36870 | HR's 21 Oct wordings: payroll answers, a friend/coworker in the account is not the employee |
| b1047ab | One employee's short answers never land on another's form |
| 9530112 | "verbal, payroll deduct no." read as the level and the payroll answer |
| c25e05c | Possessives, all-caps/lower-case names (capitalised on the card), punctuated salons, Google store codes — cherry-picked from Sunny's own unmerged c52d74c, d616cf4, fa565c0 |
| 8e3e81e | Intake stays open on a salon / "I already told you"; "my employee <name>"; CA offered beside Coaching after a repeat |
| 51e1d5e | Exact title match when a knowledge upload supersedes a document; `/api/health` no longer 500s in demo mode |
| 54b3d42, 6e92b9d | Template sync lists every failure; an interrupted publish is finished, never reported as success |
| bee01d6 (mechanism of Bubbles' store-number collision question) | A salon number that is also another salon's Google store code (306/307/314) is asked between the two for an account covering every salon, never dropped or guessed |

New end-to-end regression suite: `src/app/api/forms/hr-feedback-oct21-e2e.test.ts`
(11 of its 33 HR scenarios fail on `main`; all pass with these ports).

### Ported into Ask Bubbles from Ask Sunny

| Sunny commit | Fix |
|---|---|
| cf1480b | After a Save the card reloads its form; a refused finalize opens the policy dialog instead of a dead-end error |
| 4c15744, b78a497, 5ffa19e | Policy notices say "Woven does not see this policy in the knowledge base" |
| 1d63aeb | A Corrective Action lists the employee's forms already on file as prior actions |
| 7b3edea | Timeout headroom for two slow test suites |

### Staying one-sided (by design)

- Sunny only: EFTs (5b7686a), KS Manhattan district move, Google reviews
  posted-date anchors (76b2b85 — Bubbles already counts by Google's own create
  time).
- Bubbles only: Buff City Soap content, Store/Guest terminology, Forms Register
  name, sidebar order, Bubbles' account provisioning, `entity-facts.ts`
  (efde160), the store resolver and Woven title verification (ffea279), the
  report ask bar's form list (b87431c — Sunny lacks the feature).
- Woven-affiliation designation (Bubbles 6d388ad) is not needed: both apps now
  show a manager the forms at every location Woven assigns them.
- Sunny only: the Woven access local-stack suites delete the store mappings
  they add (b9fe177, QA LS-1). Only Sunny has a later suite (month-to-date
  reviews) that resets a mapped salon; Bubbles has no such suite, so its
  leftover rows break nothing.

### Open decisions (not ported yet)

1. Admins who aren't company-wide limited to granting their own areas (Bubbles 2123821).
2. Asking "which date goes on the form?" when two incident dates are given (Bubbles 9c02dcb).
3. Every form, not only CAs, built only from the turns about that form and person (Bubbles a73ef6c).
4. Two forms from one message, and "which one?" for a correction (Bubbles 01fa914, 8b79a46).
5. Bubbles' store resolver / Woven title verification / chat-side people lookup (ffea279, efde160).
6. A same-origin guard on Sunny's Apify review-sync admin routes.

## 22 Oct 2026: real people and the manual's wording removed (Sunny PR #130)

Ask Sunny's tests, comments and docs now use synthetic people only, the
policy-manual fixture has invented wording, and
`src/lib/security/no-real-people.test.ts` guards company addresses.

**Ported to Ask Bubbles** in Glowbrands1/Ask-bubbles#71, together with the
Corrective Action recipient fix (6b5f897). Bubbles' own company's people were
checked against its own directory and replaced too; it has no copy of the
policy-manual fixture.

## 23 Oct 2026: flagged chat-quality path (Sunny only this session)

Form-tool understanding, form-command routing, hybrid retrieval, Haiku query
rewrite, and the style-prompt rules are behind flags that default off
(`FORM_TOOLS_ENABLED`, `HYBRID_SEARCH_ENABLED`, `QUERY_REWRITE_ENABLED`,
`CHAT_STYLE_RULES_ENABLED`, `CHAT_TRACE_ENABLED`, `RETRIEVAL_RECALL_ENABLED`,
`LONG_CONTEXT_ENABLED`, `CHAT_DATA_TOOLS_ENABLED`,
`PRIOR_COACHING_OPTIONAL_ENABLED`). The house glossary and any-message rewrite
stay on `QUERY_REWRITE_ENABLED`. Recall, the longer history window, and the
read-only review/sales/comp-report tools are the later flags. Violation
phrases (cleaning, a missed deadline, policy acknowledgments, insubordination,
misconduct, must-see behaviors) sit on the glossary so recall can name the
manual section. Prior coaching is optional only when its own flag is on.
Ask Bubbles was not attached to this session, so
the mechanism was not ported. It does not rename the JBA Policy Manual and it
does not copy salon names or company wording into a sibling. Port the same
flags and files when Bubbles is in the session.

## 23 Oct 2026: live replay fixes (Sunny only)

Grounded names, a per-conversation form state, incident-matched draft
reopen, coaching citations from the same JBA manual retrieval Corrective
Action uses, review inventory totals, and conversation-scoped memory are
behind `GROUNDED_ENTITIES_ENABLED`, `FORM_STATE_ENABLED`, and the flags
already on main (`POLICY_CITATION_ENABLED`, `DRAFT_DEDUPE_ENABLED`,
`CHAT_DATA_TOOLS_ENABLED`, `CHAT_MEMORY_ENABLED`). "Show draft with edits"
keeps a filled Offense and Action Plan behind `DRAFT_MERGE_ENABLED`. The
Action Plan is two sentences behind `ACTION_PLAN_SENTENCES_ENABLED`.
Each new flag defaults off. The JBA Policy Manual is the approved citation
source: the bot cites the section and printed page and does not ask the
manager to confirm the manual. "JBA Manual" is not an employee. Finalized
forms are unchanged: an edit still opens a new draft. Migration
`20261023200000_chat_form_state.sql` is additive and is not applied.
Ask Bubbles was not attached, so this stays Sunny-only. Port the mechanism
later. Do not copy salon names or company wording, and do not rename the
JBA Policy Manual.

## 23 Oct 2026: form fixes behind more default-off flags (Sunny only)

Slot retention, field accuracy (a month-day and a payroll amount the
existing readers skip), draft reopen, a second or follow-up document, and
a JBA Policy Manual name plus printed page on coaching narrative (and an
empty Corrective Action policy line) are behind `SLOT_RETENTION_ENABLED`,
`FIELD_ACCURACY_ENABLED`, `DRAFT_DEDUPE_ENABLED`, `SECOND_FORM_ENABLED`,
and `POLICY_CITATION_ENABLED`. Each defaults off. The wrappers call the
readers Pau already shipped; they do not replace them. Ask Bubbles was
not attached, so this stays Sunny-only. Port the same flags and files
when Bubbles is in the session. Do not copy salon names or company wording.

Google review star counts, Comp Report and Sales Totals breakdowns, and
per-user memory are behind `REPORT_BREAKDOWN_ENABLED` and
`CHAT_MEMORY_ENABLED`, also default off. Product, category, employee, and
a summed week are not stored and are said to be missing. The memory
migration `20261023150000_user_memory.sql` is not applied. Ask Bubbles was
not attached. Port the mechanism later; do not copy salon names.

## 22 Oct 2026: Corrective Action QA audit (from Ask-bubbles#68)

Ported in this PR (Glowbrands1/ask-sunny#128), one `Port from Ask Bubbles
(<sha>)` commit per fix: the invented-date guard in drafted text, the draft
notice on the chat card, payroll amounts without `$` and "$0" as No, a
cancelled order beside the deduction not read as a waiver, the register
`form_date` kept in step with the Date line, the two-policy question,
autofill off on typed form fields, and the audit's manual fixture with
invented wording. Sunny-only: its payroll Yes is read only when stated, and
the warning level stays on the form.
