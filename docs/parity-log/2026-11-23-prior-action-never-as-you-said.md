# A prior action the manager never said is never saved, and never "as you said" (QA and Pau, 23 Nov 2026)

**Fix (Ask Sunny):** `src/lib/ai/agent-loop/tools.ts`, `card-record.ts`, `run.ts`, `rules-book.ts` (prompt fixtures re-taken).

**What happened live.** A one-turn chat, "create a ca for <P> she was wearing sandals at work 9/11", was finalized with
"Prior actions: Corrective Action Form, Written Warning — 09/10/2026, as you said". The manager named no earlier step.
The line came from two ARCHIVED finalized Written CAs filed under the first name alone, for three reasons:
- `finalizedPriorsOnFile` read archived forms.
- Prior actions were auto-filled from the forms on file.
- `stated.prior_actions` carried that line, while the rules book showed "<prior_actions>, as you said" with no condition.

**What changed.**
1. Prior actions hold only the manager's own steps (their dates in this request's words) or a form on file they said
   yes to. The forms on file are offered in one line (`prior_on_file.ask_exactly`, the card's `onFileOffered`), never
   added. This is the port of Ask Bubbles #1089.
2. "As you said" needs `prior_actions_evidence`: a quote of the manager's message, checked by code with
   `answerEvidence` and holding every date of the card's Prior actions. Only then does `stated_this_turn` list
   prior_actions. The rules-book read-back is conditional on that.
3. An archived form is never on file. A form under the first name alone is the person's unless another person with that
   first name is at the form's salon (Pau's rule).

Replay: `nov23-agent-loop-prior-action-never-as-you-said-cases.ts`, with Remy Calder from the pack's roster. The live
turn and the model copying the on-file line both fail on main and pass now, as do the evidence-backed "as you said", the
salon first-name rule (a Remy at the same salon is not attributed, a Remy at another salon still is) and the archived
rule. The `nov20-prior-on-file*` cases expected the old auto-fill; they were changed on purpose to the offer, each with
a comment.

**Ask Bubbles:** it already has #1089. Rule 3 is in Bubbles #1124. Bubbles has no `prior_actions_evidence` field; its
"as you said" for prior actions comes from this message's stated steps (`statedPriorActions`). Porting the evidence field
there is QA's call.
