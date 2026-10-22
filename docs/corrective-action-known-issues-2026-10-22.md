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

## Previews of `claude/*` branches are switched off

This project's preview deployments use the production database. `vercel.json`
sets `git.deploymentEnabled` to `false` for `claude/*` and `claude/**`, so pushing
such a branch builds no preview; `main` (production) and every other branch
deploy as before. The rule is read from the pushed commit: a `claude/` branch
cut from a `main` that does not yet carry it will still get previews until the
rule reaches `main`. Previews of other branches still use the production
database — a separate staging database is the real fix.

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

## Sunny: an open chat was lost on refresh — FIXED on this branch

Ask Sunny kept the address at `/chat` while a conversation was open, so a
refresh landed on an empty "How can Sunny help today?" screen and the manager had
to find the thread again in History.

Fixed: the open conversation is written to the address (`/chat?c=<id>`, history
entry replaced, not added), a refresh reopens it, a new chat (and deleting the
open thread, and Clear History) drops it, and a dashboard question (`?q=`) is
asked once and then leaves the address. See `src/features/chat/chat-address.ts`
and its tests; the local production-build browser run also refreshes in the
middle of a Corrective Action and after Create.

## Sunny: earlier finalized forms as prior actions, dated by form date

"On file in Form Monitoring" adds earlier finalized forms as prior actions, dated
by each form's date rather than the date it was signed/finalized. Two forms
finalized by repeated test runs showed as two identical lines. Worth confirming
with HR which date the line should carry.

## Sunny: import cycle — fixed on this branch, guarded by a test

A production build of the round-3 working tree answered 500 on `/api/chat` and the
forms routes. The level reader now lives in `src/lib/forms/warning-level.ts`,
which imports nothing; `round3-wording.test.ts` fails if it ever gains an import,
and `src/lib/import-cycles.test.ts` fails on any runtime import cycle in `src/`.
Production build and browser run verified after the fix.

## Duplicate Create: one mechanism

The release keeps `main`'s card-keyed row id (`cardInstanceId` in
`src/lib/forms/instances.ts`). This branch's earlier `create-once.ts` and its
optional `form_create_claims` migration were removed at the release merge, so
no migration is part of this release.

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
