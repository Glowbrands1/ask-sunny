# The model knows what the card on screen holds; this person's own card asked for again keeps its level and payroll (Ask Bubbles #1058, U21, its QA's live round 3) — ported

**Ported from Ask Bubbles #1058 at its PR head 9eeec93, before it merged** (branch `u21-r3-card-carry`; its own commits
7269026, d29694e, a934046, ef6b5be). If #1058 changes before it merges, this entry and the port are checked against the
merged commit.

**Report (Ask Bubbles' production, U21 T1–T12):** T12 "previous coaching: …" lost the account ("What happened this
time?", no Create), and the card's policy and prior actions went null. T10 "make this for <B> instead of <A>" dropped the
Verbal / payroll No that <B>'s T8 card held. At T7, the policy written as the card shows it was refused (not_a_heading),
and the reply said "That change isn't on the card yet".

**Ask Sunny: same gap.** Since the port of #1038 (#1230), Sunny's `historyReply` shows an earlier card reply as one
"[card shown under this reply: <form> …]" line, so the model did not know what the card held. propose_form rebuilds the
card from one call, and Sunny's `headingOf` read only the heading as given.

**Port (the mechanism; Sunny's own fixtures, people invented):**
- **`card-lines.ts`:** the stand-in line says what the card held, as data (`<label> = "<value>"`), taken from the app's own
  card lines in that reply. It is never a bold card line and never "as you said". A copied bracketed line is never
  shown (`withoutAppNotes`).
- **`run.ts`:** a reply that copies that line on a turn with no card call is handed back, as a copied app note is.
- **`rules-book.ts`:** a propose_form call is the whole card. Pass every value it held, with only the manager's change
  made. The prompt fixtures were re-taken, with a note in app-config.test.ts.
- **`tools.ts`, `ownCardAsked`:** the card the manager's words ask for (same_card_evidence), when it is this person's own
  by the server's record, keeps its level and payroll. Another person's card still copies them only with "the same …"
  (#1026).
- **`tools.ts`, `headingOf`:** the policy as the card shows it ("<section> — <heading>", with or without
  ", <manual> p.<n>") is read back as its heading, by the line's shape.

**Tests:**
- `card-lines.test.ts`: the stand-in expectation changes on purpose (comment), and a new test checks that the copied
  bracketed line is never shown. Both fail before the change and pass after.
- Replay `nov23-agent-loop-u21-card-keeps-what-it-held-cases.ts`, `nov23-u21-r3-whole-chat-card-keeps-what-it-held`: the
  tester's T1–T12 with invented people (Tamsyn Brevard, Ilka Morrowe) and a salon's duties, admin login. It fails on
  main at T7 (policy not_a_heading; account null). Without the history change alone it fails at T12 (account lost), and
  without the own-card carry alone at T10 (level and payroll dropped). It passes with all four parts.
- Not ported: Bubbles' open case `nov22-u21-r3-t12-form-date-not-a-prior-step`. It belongs to the form-date port.

**Live harness:** not run here. QA runs the live set.
