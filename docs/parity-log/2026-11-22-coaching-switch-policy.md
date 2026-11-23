# CA → Coaching: the coaching card keeps the heading its own account fits; a bare "Yes" sets no policy; a card's "Other — <topic>" is ticked on the saved Coaching Form (the 266-chat run's 203; Ask Bubbles' R21 / f136): Bubbles has all three, port pending

**Reports:** Ask Sunny's 203 ("Create a Coaching Form from this conversation." after a Late Opening CA: "No policy is
on the card — the Late Opening heading …") and Ask Bubbles' R21 (a dress-code CA, then the switch dropped the policy
"tell me if you'd like a different policy cited, or none"; a bare "Yes" set "Other — Dress Code"; the saved Coaching
Form ticked no coaching topic and saved no Other topic).

**QA's ruling (22 Nov 2026):** the 16 Nov ruling stands (a non-CA card never copies the CA's heading), and:

1. **The card's own account fits its heading** (`tools.ts`, `ownAccountFits`): the copied heading stays when THIS card's
   account fits it — the topic reader on the account, the manual's dress-code headings for a dress-code account
   (`dressCodeFit`), or the heading the account itself names (`headingTypedIn`, "Late Opening."). Manual headings only.
2. **A bare "Yes" sets no policy** (`tools.ts`, reason `yes_sets_no_policy`): with this form's card on screen, a message
   that is a bare affirmative (the existing `AFFIRMATIVE` reader) changes the card's policy only to one the chat's data
   gives (named, a close spelling of it, the topic reader, the card's own account, or the Other the rules keep);
   otherwise it is handed back: keep the policy and ask which, by name.
3. **"Other — <topic>" reaches the saved Coaching Form** (`draft/route.ts`): the coaching version's own Other box
   (`coaching_topics`) is ticked and `other_topic` is the card's topic, as the Corrective Action's Other already is; a
   topic the manager typed is kept.

**Ask Bubbles: same bugs (R21 is Bubbles' own report).** Bubbles main has the same `policyNotForThisCard`, no
`ownAccountFits`, no bare-yes check and no coaching Other tick in the draft route. Port the three mechanisms and the
replay cases below with Bubbles' roster, stores and manual.

**Tests:** replay `nov22-agent-loop-coaching-switch-policy-cases.ts`: the dress-code switch (R21 in Sunny's shape),
203's Late Opening switch, R21's bare "Yes", and R21's saved Other topic. All four fail on main and pass after.
