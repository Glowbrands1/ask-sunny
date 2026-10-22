# Policy source for Corrective Action forms — validation, 22 Oct 2026

Read-only investigation. No code, configuration or data was changed. Database
evidence is from `SELECT`s against the Ask Sunny Supabase project
(named "Ask Sunny Dev" in Supabase). Production writes
to it: HR's 21–22 Oct conversations and forms are stored there.

## 1. How the manual is chosen at runtime

| Step | Where | What it does |
|---|---|---|
| Brand scope | `src/lib/brand/index.ts:30,77` | `ACTIVE_BRAND = STC_BRAND`, `knowledgeScopeId: "stc-core"` |
| Candidates | `src/lib/knowledge/providers/supabase.ts:234-262` (`fetchOfficialPolicyManual`) | `knowledge_documents` in scope `stc-core`, `indexed = true`, `status = 'indexed'`; tags of superseded rows are inherited by their replacement |
| Identity | `src/lib/forms/official-policy-manual.ts:115-121, 212-249` (`OFFICIAL_POLICY_MANUAL`, `resolvePolicyManual`) | 1) tag `official-policy-manual`; else 2) file name starting `JBA-Policy-Manual`; else 3) title starting `JBA Policy Manual`. Within a tier a Woven-synced copy beats an upload; two of the same kind is refused as ambiguous |
| Callers | draft route `src/app/api/forms/instances/[id]/draft/route.ts:232`, `src/lib/ai/server-ask.ts:410,664`, `src/lib/forms/chat-policy-change.ts:329` | |

**What it resolves to today.** No document carries the `official-policy-manual`
tag. The file-name tier matches exactly one indexed row:

| id | title | file | source | category | tags | status |
|---|---|---|---|---|---|---|
| `ce6b00f1-ff30-565f-b446-53fd268a1695` | JBA Policy Manual Edited 5.2025 | JBA-Policy-Manual-Edited-5.2025.pdf | woven | policies_compliance | woven, woven-handbook | indexed (created 2026-09-29) |

Other JBA-titled rows in the same scope do not match the file-name prefix
(`2024-JBA…`, `2025-JBA…`, `policy-….txt`), and the earlier hand upload
`f527da34-…` is `superseded` by `ce6b00f1`. Every recent Sunny form's
`policy_language` provenance names `ce6b00f1` with `matchedBy: "fallback"`
(10 most recent, 2 Oct – 22 Oct 2026).

Sync record: `knowledge_sync_items` `d526dc4c-9202-43ae-ac45-152c061e92cc` — a
Woven **handbook**, status **Published**, audience **Public**, source updated
2026-05-13, last synced 2026-09-29. Ask Sunny's Woven connector reads the
company `JB & Associates` (`src/lib/knowledge-sync/woven/contract.ts:30`,
`DEFAULT_WOVEN_COMPANY`; overridable by `WOVEN_TEAM_COMPANY`).

## 2. Approval status

- **No explicit approval record designates this document as Ask Sunny's
  official Corrective Action policy source.** It is selected by a code
  heuristic (file-name prefix), not by a tag or a pinned id set by a person.
- Indirect evidence that it is the business's manual: it is published to all
  employees ("Public") in the JB & Associates Woven account Ask Sunny syncs
  from; HR's own requests cite it ("previous coaching: JBA Policy Manual
  7-29-26"); `docs/woven-knowledge-sync.md:230` and
  `docs/hr-feedback-2026-09-30.md:34` describe the CA form citing it. None of
  these is a recorded approval.
- `knowledge_sync_audience_decisions` (15 rows, all `company_wide`, decided by
  an administrator on 29–30 Sep 2026) approve which Woven
  audiences are synced company-wide. None is keyed `Public`, and none says
  which document is the policy source.

## 3. Tenant isolation

- Ask Sunny has its own Supabase project, separate from any other tenant's. Ask Sunny's knowledge rows are all scope `stc-core`
  (597 indexed, 18 failed, 7 retired, 7 superseded); no `bcs-core` row exists.
- The Vercel project holds its own `NEXT_PUBLIC_SUPABASE_URL` /
  `SUPABASE_SECRET_KEY` (values encrypted, not read).
- `src/lib/brand/index.ts:45-53` contains a `BCS_BRAND_DRAFT` config, but
  `ACTIVE_BRAND` is `STC_BRAND`; nothing selects the draft.
- Ask Sunny's citations come only from `ce6b00f1` in its own database.
- Ask Sunny has no automated tenant-isolation suite (Ask Bubbles has
  `src/lib/knowledge-sync/woven/bcs/tenant-isolation.test.ts`).

## 4. Fail-closed behaviour today

- No manual, or an ambiguous one: `fetchOfficialPolicyManual` returns
  `ok: false` ("…not in the knowledge base, so no policy was cited" /
  "More than one document claims to be the official policy manual…").
  The draft is still created; policy fields stay blank and the card says so.
- A policy value can only be written with `provenance.verified: true`
  (`refuseUnverifiedPolicyValues`, `src/lib/forms/policy-grounding.ts:243`,
  used at `src/lib/forms/instances.ts:652,713`). Finalize asks for an explicit
  acknowledgement for any unverified policy field.

Proposal text that mentions a policy **before** the draft:

| Line | Source | Reads as |
|---|---|---|
| "this reads as **Standards of Conduct** — … I'll check it against the current policy manual and quote that section on the draft; if the manual doesn't support it, I'll leave the policy for you. Tell me if a different policy applies." | `ca-policy.ts` `caPolicyProposalLine` | Suggestion, conditional on the manual |
| "this reads as **Attendance** — a required meeting that was missed. I'll quote that section from the current policy manual on the draft under **Absenteeism**; tell me if a different policy applies." | same (added on the feature branch, 22 Oct) | Suggestion, but **not** conditional on the manual |
| "<Heading>, from what you described … the policy manual's section on page N" | `namedPolicyLine` | Only when the heading was found in the manual |

At the draft the Standards of Conduct suggestion is applied only where the
manual's own section lists the infraction (`groundConductPolicy`). The branch's
missed-meeting reading ticks **Absenteeism** without checking the manual; the
quoted text is still verified, and is blank if the manual has no Attendance
section.

## 5. What the business needs to decide (nothing changed here)

1. Confirm that the JB & Associates handbook "JBA Policy Manual Edited 5.2025"
   (Woven handbook, sync item `d526dc4c-…`, document `ce6b00f1-…`) is the
   approved policy source for Sun Tan City Corrective Action forms.
2. Record that approval explicitly: tag the document `official-policy-manual`
   in the Knowledge Base (the tier `resolvePolicyManual` prefers), or pin its
   Woven handbook id in code the way Ask Bubbles does
   (`WOVEN_KNOWLEDGE_OWNERSHIP_REVIEW.confirmedEntityIds`).
3. Until then, the source is chosen by a file-name heuristic, and a re-issued
   manual under a different file name would silently stop matching (fail
   closed) or, with two matches, be refused as ambiguous.

## Recommended code change

Make the missed-meeting reading as conservative as the conduct one:

- In `src/lib/forms/ca-policy.ts`, word the Attendance proposal line like the
  Standards of Conduct one: "…I'll check it against the current policy manual
  and quote that section on the draft; if the manual doesn't support it, I'll
  leave the policy for you…".
- In the draft route, apply `describedOffenseKeys` only when the pinned
  manual's Attendance section contains the meetings line (an `ANCHORS`-style
  check such as `/seminars?\s*\/\s*meetings?\s*\/\s*training sessions? are considered scheduled shifts/i`
  against `sectionText(chunks, Attendance)`); otherwise leave the model's box,
  as `groundConductPolicy` does.
- Optionally, when `resolvePolicyManual` matched by `fallback` rather than
  `tag`, add a short note on the card ("cited from the manual found by name;
  confirm it is your approved manual"). This would surface the missing approval
  without blocking the draft.

## Changes made on the feature branch (uncommitted, 22 Oct 2026)

- **Missed meeting → Attendance is grounded in the manual.** `describedOffenseKeys` ticks Absenteeism only when the pinned manual's Attendance section, as it reads today, says "Seminars/Meetings/ Training sessions are considered scheduled shifts". Without that line, or without a manual, the draft's own box stands. The chat line is worded as a suggestion to be checked against the manual, like the Standards of Conduct one. `src/lib/forms/ca-policy.ts`, `src/app/api/forms/instances/[id]/draft/route.ts`.
- **Card notice for an unapproved source (Ask Sunny only).** When a quoted policy's stored provenance says the manual was found by name (`matchedBy: "fallback"`), the Corrective Action card now says the manual "hasn't been confirmed as Sun Tan City's approved policy source" and asks the manager to check the policy before issuing. The draft and the quote are kept. The notice goes away for a manual found by the `official-policy-manual` tag, so tagging the confirmed document (a business decision, above) is all it takes. `policySourceNoticeFor`, `src/features/chat/inline-form.tsx`.
- No production configuration, tag or document was changed.
