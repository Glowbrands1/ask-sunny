# "drs note" is a doctor's note, in the loop and the question path (20 Nov 2026)

**Sibling app: the loop part is not needed** (Ask Bubbles has no agent loop yet). **The retrieval part stays Sunny-only:**
it maps the shorthand to this app's JBA Attendance section (`policy-retrieval.ts`'s synonym map); the sibling app's
manual and its own synonym map would need their own entry, with their own wording, if its managers use the shorthand.

Pau via QA: managers' shorthand "dr", "dr.", "drs", "dr note", "drs note", "dr's note" means doctor / doctor's note. The
rules book now says so in one explicit line: never a person, name or title (no find_staff, no Did-you-mean), spelled out
as "doctor's note" in the account, the reply and tool queries, and an absence told with or without one is an attendance
account (the manual's Attendance section: absent more than two days needs a doctor's note on return). No word list in
code. Production's chat_messages (read only) hold three managers' messages with this wording, all policy questions; the
replay cases use one of them word for word.

QA's production audit: "when does employee need to provide drs note" on the question path (not the loop) was answered from
Immigration Law Compliance. The retrieval synonym map now places the shorthand in the Attendance section, so the search
asks for it (replay cases in the three managers' exact wordings).

Port with the rest of the loop when Ask Bubbles gets it.
