# Agent loop batch K, K-keep: the 266 shadow replay's guard breaches (15 Nov 2026)

**Ask Bubbles: not needed yet** (v2-Coding-7). Every item is in the agent loop (`src/lib/ai/agent-loop/`). Ask Bubbles has no agent loop yet. When the loop is ported, port these with it, using store wording.

Kept from batch K (the rebuild plan's K-keep):
- **K1:** a close spelling is never seated (`NEAR_MISS_NEVER_SEATED_ENABLED`, on; Pau 15 Nov: A).
- **K2:** a single word seats only a whole first name.
- **K4:** `account_names_other_person`.
- **K5(b):** a payroll answer holds on later turns of the SAME person's request (`payroll_said_earlier`); it never reaches another person's card.
- **K6:** a date from another request is not kept.
- **K12a/b:** rules-book lines, and find_staff's `also_ask_if_no_account`.

Dropped, to be rebuilt as evidence arguments in the rebuild's PR 1 (no new message or reply readers): K3a/K3b (the person-slot reader and the "who is it for" reply check) and K5(a) (the payroll-only reply reader).

Today's path is unchanged. These are the loop's counterparts of today's own rules: NEAR_MISS / Did-you-mean, FIRST_NAME_ASK and the payroll question. Bubbles' today path already has them.
