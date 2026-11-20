# Agent loop: "drs note" is a doctor's note (20 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Pau via QA: managers' shorthand "dr", "dr.", "drs", "dr note", "drs note", "dr's note" means doctor / doctor's note. The
rules book now says so in one explicit line: never a person, name or title (no find_staff, no Did-you-mean), spelled out
as "doctor's note" in the account, the reply and tool queries, and an absence told with or without one is an attendance
account (the manual's Attendance section: absent more than two days needs a doctor's note on return). No word list in
code. Production's chat_messages (read only) hold three managers' messages with this wording, all policy questions; the
replay cases use one of them word for word.

Port with the rest of the loop when Ask Bubbles gets it.
