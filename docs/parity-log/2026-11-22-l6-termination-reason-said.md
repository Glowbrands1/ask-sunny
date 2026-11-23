# A termination's stated reason reaches the card and the saved form when the model writes no account (Ask Bubbles #1052, aff3547e, its coder 5's live triage, l6) — ported

**Report (Ask Bubbles' production):** "exit form for <P>, terminated for job abandonment, not eligible for rehire" made a
termination card with no account in both live runs; run 1's reply offered "The reason (job abandonment) isn't on the card
yet unless you'd like it added".

**Ask Sunny: same gap.** Sunny's termination reason came only from the model's account; exit_reason (the #1047 port, same
pull request) applied to a resignation only. The replay case below fails without this change.

**Port (the mechanism):** `src/lib/ai/agent-loop/tools.ts`: `exit_reason` also applies to a termination (exit_type
"termination", locked on the termination word), with the same `answerEvidence` and every-word quote checks. With no account
from the model, the checked reason is the termination card's account, which Create already saves as its Reason line. Tool
description and rules book: pass it on a termination too, and never offer to add a reason the model can pass (fixtures
re-taken, noted in `app-config.test.ts`).

**Tests:** replay `nov22-agent-loop-l6-termination-reason-said-cases.ts` (QA's wording, the invented Rowan Kestrel of
Sunny's existing l6 cases): the fix case fails before (2 runs: both flag modes), passes after; the no-reason control
holds before and after.

**Live harness:** not run here (the permission check refused the key); QA runs Sunny's live set from their session.
