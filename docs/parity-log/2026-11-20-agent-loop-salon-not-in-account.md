# 2026-11-20 — agent loop: the salon the manager named is not part of the account

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds: when the loop card's salon (store in
Bubbles) is one the manager named in this request, a whole "at / in <that salon>" phrase leaves the card's account
(`withoutNamedSalon` in tools.ts); any other place, a longer proper noun or a work area stays word for word. The legacy
path's own place strip (PLACE_STRIP_WHOLE_PHRASE_ONLY) already does this for its Observation. Port with the loop.
