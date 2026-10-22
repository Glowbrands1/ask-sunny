# Parity log: Ask Sunny ↔ Ask Bubbles

Ask Bubbles (`Glowbrands1/Ask-bubbles`) is a port of this app. Every fix to
chat, forms, Corrective Action, policy citation, access or sync is either
ported to the sibling or listed here as staying one-sided, with the reason.
See `CLAUDE.md`.

## 22 Oct 2026: both apps brought level

Every chat/forms fix merged to either `main` from 12–21 Oct was compared. The
gaps below were closed. Everything else already existed in both.

### Ported into Ask Sunny from Ask Bubbles

| Bubbles commit | Fix |
|---|---|
| c32eb59 (+ Sunny's own unmerged 0090bef) | The open conversation stays in the address; a reload reopens it |
| fe871f1 | Confirm before deleting a conversation or finalizing a form |
| ab77b14 (+ Reviews/Videos from Sunny's unmerged c2a0e88) | Small links and buttons at least 24px to tap |
| 062e5dc | Browser autofill off on every typed form field |
| 987e4b7 | "Create a form" shown only to an account that may create one |
| 4cbb84c | "write a CA for X" read as a request; the CA leads when asked for |
| 8cdc41b | What an earlier coaching was for stays on the history line |
| ac36870 | HR's 21 Oct wordings: payroll answers, a friend/coworker in the account is not the employee |
| b1047ab | One employee's short answers never land on another's form |
| 9530112 | "verbal, payroll deduct no." read as the level and the payroll answer |
| c25e05c | Possessives, all-caps/lower-case names (capitalised on the card), punctuated salons, Google store codes — cherry-picked from Sunny's own unmerged c52d74c, d616cf4, fa565c0 |
| 8e3e81e | Intake stays open on a salon / "I already told you"; "my employee <name>"; CA offered beside Coaching after a repeat |
| 51e1d5e | Exact title match when a knowledge upload supersedes a document; `/api/health` no longer 500s in demo mode |
| 54b3d42, 6e92b9d | Template sync lists every failure; an interrupted publish is finished, never reported as success |

New end-to-end regression suite: `src/app/api/forms/hr-feedback-oct21-e2e.test.ts`
(9 of its first 30 HR scenarios failed on `main` before these ports).

### Ported into Ask Bubbles from Ask Sunny

| Sunny commit | Fix |
|---|---|
| cf1480b | After a Save the card reloads its form; a refused finalize opens the policy dialog instead of a dead-end error |
| 4c15744, b78a497, 5ffa19e | Policy notices say "Woven does not see this policy in the knowledge base" |
| 1d63aeb | A Corrective Action lists the employee's forms already on file as prior actions |
| 7b3edea | Timeout headroom for two slow test suites |

### Staying one-sided (by design)

- Sunny only: EFTs (5b7686a), KS Manhattan district move, Google reviews
  posted-date anchors (76b2b85 — Bubbles already counts by Google's own create
  time).
- Bubbles only: Buff City Soap content, Store/Guest terminology, Forms Register
  name, sidebar order, Bubbles' account provisioning, `entity-facts.ts`
  (efde160), the store resolver and Woven title verification (ffea279), the
  report ask bar's form list (b87431c — Sunny lacks the feature).
- Woven-affiliation designation (Bubbles 6d388ad) is not needed: both apps now
  show a manager the forms at every location Woven assigns them.

### Open decisions (not ported yet)

1. Admins who aren't company-wide limited to granting their own areas (Bubbles 2123821).
2. Asking "which date goes on the form?" when two incident dates are given (Bubbles).
3. Every form, not only CAs, built only from the turns about that form and person (Bubbles a73ef6c).
4. Two forms from one message, and "which one?" for a correction (Bubbles 01fa914, 8b79a46).
5. Bubbles' store resolver / Woven title verification / chat-side people lookup (ffea279, efde160).
6. A same-origin guard on Sunny's Apify review-sync admin routes.
