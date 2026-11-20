# 2026-11-20 — agent loop: exit_not_stated asks, never steers to a CA

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (propose_form in tools.ts, rules-book
line on exit_not_stated): an exit card refused for no exit_evidence makes no card and asks, neutrally, whether the person
resigned or was terminated, offering both forms (ask_exactly); it no longer tells the model to make a Corrective Action.
Port with the loop.
