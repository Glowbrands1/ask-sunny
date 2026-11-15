# Agent loop: the Ask Bubbles port list (kept by QA)

Pau, 15 Nov 2026: "we fix bubbles soon, sunny first". Ask Sunny's agent loop is
being fixed, tested live and piloted first. Ask Bubbles gets it after that. This
file is the one list of what has to move, so nothing is missed when the port
starts.

**Only QA edits this file.** It is updated after each merge. Coding sessions
still add their own parity-log entry per pull request, as the README says, so
pull requests never conflict here.

Porting rules (CLAUDE.md): port the mechanism, never one company's content.
Sunny ↔ Bubbles, salon ↔ store, Form Monitoring ↔ Forms Register. Both apps cite
the JBA Policy Manual, and its title is never renamed. Both apps run on Central
Time.

## 1. The loop itself: not in Ask Bubbles yet (`src/lib/ai/agent-loop/` does not exist there)

Port these in order, as one ported loop behind the same switch
(`AGENT_LOOP_ENABLED` + `AGENT_LOOP_USERS`, one test user first):

| Sunny PR | What it adds |
|---|---|
| #995 | AI time limits (loop part 1) |
| #992 | The loop, its tools (`find_staff`, `find_past_forms`, `read_form`, `propose_form`, `edit_form`, `read_policy`), the route hook, the switch |
| #996 | Batch A: replies are the model's own words; Create uses the card's policy |
| #997 | Hotfix: self-review before replying about a card; level and payroll answers re-propose the card |
| #998 | Batch B: card values as facts, plus live-app fixes |
| #999 | Batch C: validators become facts; places kept as said; the right-person refusal stays |
| #1000 | Batch D: the draft honesty check hands back once |
| #1001 | Data tools `read_reviews` and `read_stats`, scoped to the manager's own salons (stores) |
| #1003 | Batch E: dates in any format (6-11, 6/11, June 11), staff count and position, the full Policy line, key-holder card, "same thing for", "use that one" |
| #1002 (open) | Batch F: one step budget, honest partial replies, `updated_at` touch on chat edits (flag `FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED`) |
| batch G (open) | G0–G19: past-forms gate, payroll as stated, exit forms, dictated Action Plan, termination on the card and the draft with the DM/HR approval line and the termination closing, future dates where meant (follow-up, exit last day), reword with new facts, salon from Woven, who-did-what kept, ask once |
| batch H (open) | The 16 after-merge parity gaps |

## 2. App-wide changes (outside the loop)

| Change | Ask Bubbles |
|---|---|
| Fonts from local files (Sunny #1004) | Ported: Ask-bubbles #921 |
| Central Time everywhere, never "UTC" in a reply (Coding-8) | Ported in the same work |
| Readable names ("De la Torre", not "de la tore") (Coding-2) | Ported in the same work |
| Termination in chat; the wrong-person matcher (Coding-2) | Ported in the same work |
| Chat edits touch `updated_at` (batch F, F8) | Ask-bubbles #920; flag flipped at merge |

## 3. Ask Bubbles' own items to check once the loop is ported

- The 15 Nov silent-failure scan included a Bubbles chat. Re-run its exact
  wording on the ported loop before Bubbles' test user gets it.
- Bubbles' default business time zone is already America/Chicago. Check that its
  production env agrees.

## 4. Later, both apps

The other 14 form types (batch I), the "See past forms" button, per-manager
memory.
