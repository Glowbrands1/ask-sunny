# 2026-11-20 — agent loop: a switched card keeps the request's heading; a reply never claims a card that was not made

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds (QA's ruling on f074, option b): two
headings stay the Corrective Action's only; any other card given two cites the first and leaves the second off
(not_on_card), never refusing the card; a same-request switch (form_change_evidence) keeps the CA's heading as the
card's own, never "copied" (a copy with no switch is still left off). run.ts hands back, then corrects, a reply that says
a form was made when propose_form made no card this turn, or that promises later work or blames "an issue on my end"
(#1162's wording). Port with the loop.
