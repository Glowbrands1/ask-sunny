# Gate-Sunny-3 — #898 HUMAN_REPLIES_ENABLED (card-opener-once, QA's ruling b) — GO (3+3)

- Head `cd3d8ddf2` (Coding-6). Merged onto main `1ecadf923`: conflicts in flags-off-parity and chat-quality-flags (kept
  both sides). The closing `}` of `draftNoInventedPlanEnabled` had to be restored by hand; then tsc is clean. **Coding-6
  should rebase.**
- 3 OFF + 3 ON (a wide reply-text change), full suite, production flags in the env.

| run | failed (OFF) | failed (ON) |
|---|---|---|
| 1 | 1,264 | 1,265 |
| 2 | 1,263 | 1,265 |
| 3 | 1,264 | 1,267 |

Replay text is **byte-identical across the 3 OFF runs and across the 3 ON runs**. The only tests that pass in every
OFF run and fail in every ON run: the target `nov10-card-opener-once-ca-chain` OPEN arm (now holds; INTENDED) and
flags-off-parity's child (INTENDED-HARNESS). Everything else varying is the known chat-trace / load noise.

Replay text OFF vs ON: **288 records differ** (49 patterns), all still passing apart from the target. I checked every
changed reply:
- **0 card lines differ.** With opener lines set aside, the Policy line, Date, Job title, Observation of Offense,
  Action Plan, Type of Warning, citation line, the payroll question, "won't guess" and "Create the draft here …" are
  identical OFF vs ON in every changed reply.
- **Only the opener changes**, and **never on a chat's first card turn** (0 cases). The removed lines are the long
  opener ("I'll draft a **<form>** for **<name>** from what you've described, and check the applicable company policy
  …", 301), "Here is what I would put on a **<form>**." (94) and "Everything I need is here, drawn from your messages
  above." (76). They're replaced by a short line naming what changed: "I'll draft a **<form>** for **<name>** — got
  it, here's the card." (125), "… — got it, it's for **<name>**." (66), "Got it — here's the card." (44), "… the date's
  11/3", "… no payroll deduct", "… it's a verbal warning" and similar. A CA keeps its "I'll draft a **<form>** for
  **<name>**" lead.
- The watched cases still pass: `nov8-near-miss-card-kept-r6-t7`, `nov8-proposal-name-correction-r6-t7`,
  `nov5-r6-policy-kept-across-turns`.

Class: INTENDED-ADJACENT (ruling b's wording on later card turns). 0 REGRESSION.

Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The case that now holds is `nov10-card-opener-once-ca-chain`. After the flip, expect every later card turn in a
chat to open with the short "got it, …" line.
