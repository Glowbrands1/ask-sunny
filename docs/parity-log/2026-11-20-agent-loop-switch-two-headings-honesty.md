# 2026-11-20 — agent loop: a switched card is made with one heading; a reply never claims a card that was not made

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds (QA's rulings on f074): two headings stay
the Corrective Action's only; any other card given two cites the first and leaves the second off (not_on_card), never
refusing the card; a heading copied from another form's card still follows c014 even on a switch (policy_copied). run.ts
hands back, then corrects, a reply that says a form was made when propose_form made no card this turn, or that promises
later work or blames "an issue on my end" (#1162's wording). Port with the loop.
