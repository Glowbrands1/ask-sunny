# Ported from Ask Bubbles (#1019, U35): a stated level and payroll answer stay on the card for the rest of the request (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Bubbles noted that Sunny's `carriedRecord` and `openCard` are the same code.
Mechanism only.

QA's ruling (22 Nov 2026) amends the 16 Nov rule for replies that show no card. With no card on screen and no form open,
the request's latest record of this card (same form, same person, same request) still carries its warning level and its
payroll answer. They stop carrying at a new request (new_form_evidence), at another person, or at another form.

Replay: `nov22-agent-loop-answers-carry-in-request-cases.ts`. It uses QA's T2, T3, T10 and T11, with Sunny's invented
Remy Calder at Kearney. It fails before the port (the level is lost after "can i review the card") and passes after.

**QA's ruling on this port (22 Nov 2026, option B, safety first).** With no card on screen, an answer carries only while
the card is the same incident as the record it comes from. That is read from data, never words: the same account key
(the account and its date, as the record keeps it), or, with no account given, the same incident date. A card whose
account is a new incident ("another ca for <name>, late on 11/14 too") starts clean, even without new_form_evidence. The
three 16 Nov cases (nov15-agent-loop-pr1c-older-payroll-answer-is-not-a-new-cards,
nov16-open-card-keeps-payroll-control-new-incident, nov16-level-carry-guard-after-a-reply-with-no-card) pass unchanged.
QA asked Bubbles to add the same boundary to #1019.
