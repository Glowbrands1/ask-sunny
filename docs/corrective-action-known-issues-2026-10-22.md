# Corrective Action — remaining issues after round-3 QA, 22 Oct 2026

Branch `claude/lucid-goodall-06noak`. These are known and NOT fixed on this
branch. Each says what was observed, why it matters, and what would close it.

## Validation that was not done

### No test against the real model on a staging environment
Everything was tested with the rule-based readers, an in-memory fake database,
and — in the browser — a production build against a throwaway local
Supabase-shaped stack with a local stand-in for the Anthropic API that returns
scripted drafts. The real model's wording of drafts, and its behaviour on
unusual accounts, has **not** been exercised by this round.

Why: this project's Vercel preview deployments use the production database, so
a preview is not a safe staging environment for creating disciplinary records,
and no model API key was available to the QA environment.

To close: a staging Supabase project (or a preview environment pointed at one),
seeded with synthetic people and the manual, plus a model key scoped to it. Then
run the browser spec (`e2e-local/ca-flow.spec.ts` in the QA harness) against it.

### Natural language is still rule-based
Request, level, payroll, date, prior-action and policy readers are regular
expressions. Round 3 tested 26 phrasings (16 written without looking at the
readers) through to the saved form, plus negatives, and all pass — but new
wording will still find gaps. Treat each one reported from the field as a test
case first.

## Policy manual approval

Ask Sunny cites "the official policy manual" chosen by its title in the knowledge
base. Nothing records that the uploaded document is the company's **approved**
manual: there is no approval flag, approver or date on the document, and the
`knowledge_sync_audience_decisions` rows approve audiences, not a policy source.
See `docs/policy-source-validation-2026-10-22.md`.

What the code does today: a missing or ambiguous manual is never guessed at — the
draft is kept, the policy lines are left for the manager, and finalizing an
unverified quote needs an explicit acknowledgement. What it cannot do is tell an
approved manual from any document with the right title.

To close: an explicit, auditable designation of the approved manual per tenant
(who approved it, when, which version), checked before a quote is marked
verified. This is a product and HR decision, not only a code change.

## Sunny: an open chat is lost on refresh

Ask Sunny keeps the address at `/chat` while a conversation is open; a browser
refresh lands on an empty "How can Sunny help today?" screen. Nothing is lost —
the conversation, its card and any created form are in History — but a manager
mid-way through a Corrective Action has to find the thread again. (Ask Bubbles
keeps the conversation in the address, `/chat?c=conv_…`, and reopens it.)

To close: put the open conversation id in the URL and restore it on load.

## Sunny: earlier finalized forms as prior actions, dated by form date

"On file in Form Monitoring" adds earlier finalized forms as prior actions, dated
by each form's date rather than the date it was signed/finalized. Two forms
finalized by repeated test runs showed as two identical lines. Worth confirming
with HR which date the line should carry.

## Sunny: import cycle — fixed on this branch, guarded by a test

A production build of the round-3 working tree answered 500 on `/api/chat` and the
forms routes. The level reader now lives in `src/lib/forms/warning-level.ts`,
which imports nothing; `round3-wording.test.ts` fails if it ever gains an import.
Production build and browser run verified after the fix.

## Sunny: optional migration not applied

`supabase/migrations/20261022001000_form_create_claims.sql` adds a claims table
for duplicate-Create protection. The protection on this branch does not need it
(the card-derived form id and the table's primary key already make a repeated
Create file one form). Apply only if wanted, through the normal migration path.

## Behaviour unchanged from origin/main (noted, not changed)

- A remark about history alone ("tess varga had a written warning last month for
  tardiness") still proposes a Corrective Action card. Nothing is filed without
  Create.
- A message of eight words or fewer that names a policy is read as the answer to
  "which policy?".
- Plain lateness and a register shortage are asked about rather than mapped to a
  policy automatically (by design).
- Switching the policy in chat changes the cited section; Policy Violated keeps
  naming the offense box the form already has ticked (by design).
