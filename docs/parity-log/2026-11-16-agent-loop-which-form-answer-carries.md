# 2026-11-16 — agent loop: the answer to "which one?" carries the request's edit

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds: the turns of the OPEN request a message
finishes (each answered by a loop turn that saved nothing and made no card, per the trace records) carry their edit to
the answer turn, with the same evidence rules as the message itself (`openRequestTurns`, `answerEvidenceInOpenRequest`
in tools.ts); a finished request's never do. Port with the loop.
