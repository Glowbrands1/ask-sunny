# 2026-11-16 — agent loop: a typed name is taken; a settled name stays settled

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds (QA, the 266 re-run's c220, c224,
c022): a job title beside a name is not part of it (`withoutJobTitle`, titles from the app config's `jobTitles`); a full
name the manager typed that is a close spelling of nobody on the roster is taken as typed; a name settled once in the
chat (kept as typed, or already on the off-roster card) is never asked about again; find_staff's Did-you-mean carries
reason_code and ask_exactly, so a repeated one ends on the question. When the loop is ported, give Bubbles' config its
own job titles (store roles); the mechanism names none.
