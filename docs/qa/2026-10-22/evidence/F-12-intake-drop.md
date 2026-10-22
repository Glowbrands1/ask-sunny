# F-12 — Sunny drops an open intake when the manager answers "which salon?" with a bare number

**Reproduction (probe U8, Sunny, W1+W3 integrated `2790542`; also on `main`):** a salon director covering loc-0310 and loc-0410,
1. "create a coaching form for pat rivera, late 3 times" → Coaching card, Pat Rivera, `needs_location` ("Which salon is this about?")
2. "410" → **no card**; a model answer plus a form-suggestion picker. Bubbles, same flow with "‹Bubbles store number›": the card stays, store asked/selected, Pat Rivera kept.

**Root cause.**
- `continuesIntake` (`ask-sunny/src/lib/ai/form-proposal.ts:1297`) keeps an open intake only if the reply names a person, an employment change, a salon via `readSalonMentions`, "I already told you", an incident, a date, a topic, or "go ahead". A bare "410" matches none: `readSalonMentions` needs a location word or a zero-padded number (deliberately so after F-05, and on `main` it never read a bare reply either).
- The turn therefore falls to the grounded path, and `suggestFormsForTurn` appends a `formSelection` picker.
- `continuationFor` (`src/lib/forms/proposal-continuation.ts:130`) **stops at a `formSelection`**, so the open Coaching intake is gone for every later turn.
- Bubbles has a dedicated rule Sunny lacks: `continuesStore` / `storeQuestionOpen` / `bareStoreReply` (`Ask-bubbles/src/lib/forms/store-confirmation.ts:35-85`): when the last assistant turn asked for the store, a short whole-message reply that resolves to a roster store keeps the intake and is read as the store.

**Impact.** Medium-low. Fails safe: nothing is saved and no wrong salon is filled in. But the manager's answer is discarded, the card disappears and they must start again. The card's own "Which salon is this about?" dropdown is a working alternative. The same class also hits other one-word answers after a ready card (e.g. "today" in B3).

**Recommended fix (not applied — outside the nine authorised fixes, awaiting approval).** Port Bubbles' mechanism to Sunny:
- while the last assistant turn asked which salon (or the open proposal is `needs_location`), a whole-message reply of ≤ 4 words that resolves to exactly one salon *by number or name* is the salon answer;
- the salon must still come from the actor's authorised list; an unassigned one gives the existing out-of-scope prompt;
- 306/307/314-style collisions ask again, and it is never read as an employee;
- tests: "410", "0410", "#410", "omaha pacific" (authorised); "462" (unassigned); "306" (collision); "410?" (question) — single- and multi-turn.

Separately, consider not ending an open intake when the picker was produced only by `suggestFormsForTurn` (a suggestion, not a choice the manager made).
