# Agent loop batch K: the 266 shadow replay's guard breaches (15 Nov 2026)

**Ask Bubbles: not needed yet** (v2-Coding-7). Every item is in the agent loop (`src/lib/ai/agent-loop/`). Ask Bubbles has no agent loop yet. When the loop is ported, port these with it, using store wording.

- **K1** (`NEAR_MISS_NEVER_SEATED_ENABLED`, default off until Pau rules): a close spelling is never seated. find_staff's card-person shortcut is used only for a person the manager typed or confirmed.
- **K2:** a single word seats only a whole first name.
- **K3:** a name in the person slot gets the "reply **use <name>**" offer. A name never looked up goes back to the model once (run.ts).
- **K4:** `account_names_other_person`.
- **K5:** `asksOnlyPayroll` and `payroll_said_earlier`.
- **K6:** a date from another request is not kept.
- **K12:** the rules-book line "never expand a typed word".

Today's path is unchanged. These are the loop's counterparts of today's own rules: NEAR_MISS / Did-you-mean, FIRST_NAME_ASK, OFF_ROSTER_CONFIRM, and the payroll question. Bubbles' today path already has them.
