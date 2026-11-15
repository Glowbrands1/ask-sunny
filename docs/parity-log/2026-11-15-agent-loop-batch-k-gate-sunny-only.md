## 15 Nov 2026: agent loop batch K ("ready", CA-only fields; K7 dropped for forms_on_file_evidence) — Sunny-only

QA's 266-chat shadow replay: K10 the reply said a card was ready when
`card.status` was not (rules-book line plus a `ready` fact on propose_form / edit_form cards); K11 a Coaching card made from a CA
conversation carried payroll = no (payroll deduct, warning level and termination are kept only on a Corrective Action).

Sibling app (Ask Bubbles): not needed. Bubbles has no agent loop (`src/lib/ai/agent-loop/`), no `find_past_forms` gate, no
rules book and no `propose_form` tool. Its form-slot path already clears the CA-only slots for another template
(`form-full-remap.ts`, the same mechanism that gives Sunny's non-loop chat the behavior).
