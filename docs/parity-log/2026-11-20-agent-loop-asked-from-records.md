# 2026-11-20 — agent loop: what Sunny asked is read from records, never the reply or turn order

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds (the follow-up of closed #1055): a card
that asks which date records "form_date" in its card record's asked fields, and dates_asked_before reads the records
(no regex over Sunny's replies); the tools' exit-form offer (the exit refusals, a termination card) writes an exit_offer
record (one-way person keys), and a "yes" is a yes to that offer only when the reply right before it carries the record
for that person (never turn order alone). Port with the loop.
