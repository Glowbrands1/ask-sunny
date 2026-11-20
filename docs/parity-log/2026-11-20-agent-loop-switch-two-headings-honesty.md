# 2026-11-20 — agent loop: a coaching card may cite two headings; a reply never claims a card that was not made

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds: the forms whose cards always cite a
policy (Corrective Action, Coaching, Follow-Up Coaching) may cite two headings (#1154 allowed the CA only), with each
copied heading held to c014's rule (policy_copied); and run.ts hands back, then corrects, a reply that says a form was
made when propose_form made no card this turn, or that promises later work (a follow-up, a resend, "on my end"). Port with
the loop.
