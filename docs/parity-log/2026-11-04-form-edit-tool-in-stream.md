## 4 Nov 2026: the edit tool in the main call, Step 3 — ported from Ask Bubbles (c5534279, #416) (FORM_EDIT_TOOL_IN_STREAM_ENABLED, default off)

Port of the sibling app's Step 3, the mechanism in this app's setting. With a
draft open and a turn that is not a question, a correction, a name fix or a
policy change, the answering call (`server-ask.ts` → `callClaude`) is offered
one tool, `edit_form` (the owner's approved description, verbatim, the same
in both apps), with the open form as JSON and the scoped staff (name,
position, salon) in one extra data block before the question. A tool call is
written through `writeFormEdits` (path "tool", all or nothing) and answered
from the saved diff; otherwise the turn goes to the old chain. One model call;
nothing is sent back. Needs FORM_EDIT_SINGLE_WRITER_ENABLED. The question
gate's `ABLE_TO_ACT` branch is read only by this flag's gate.

Where this app differs: its answering call always streams through
`messages.create` and `collectModelResult`, which now also collects
`tool_use` blocks (a finished message) and `content_block_start` +
`input_json_delta` (a stream); absent a tool call, its result is as before.
Its intake answers some open-draft turns with a card for the form already
open before the answering call is made; with the tool offered, such a card
(the same template for the same employee) is not the turn's answer, so the
turn reaches the call that carries the tool. Without the offer, unchanged.

Found by this port's classification (a REGRESSION, fixed here with a test that
fails before and passes after): with the tool on, the answering call is made
before the old chain, and when it failed (a model or configuration error) the
whole turn failed, on a turn the old chain answers without it. Now a failed
main call is no offer: the chain answers, and the last fallback carries no
offer (`route.ts`; the failure is recorded as `handoff: "error"`). Ask Bubbles
has the same code at the same place (`src/app/api/chat/route.ts`, its
`toolMain`): **to port there** — not done in this change, which works in this
repository only.
