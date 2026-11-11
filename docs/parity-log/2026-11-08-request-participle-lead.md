# Sunny-only: "made for" after the form is the request (REQUEST_PARTICIPLE_LEAD_ENABLED)

QA's round-5 live Sunny check (8 Nov 2026, history 1143df48): "I need a corrective action made for under
performance. <A> was below on PPTA, …" made the card's Observation of Offense start mid-sentence: "made for under
performance. <A> was below …". The request lead (`ai/remap-incident.ts` REQUEST_LEAD) read "I need a corrective
action" but not a past participle before the "for". With the flag on, "made / done / written up / drawn up / filled out
… for" after the form is part of the request, and a request sentence whose rest is only a sales reason ("under
performance", `forms/ca-policy.ts` isSalesPolicyReading) is left out of the Observation when another sentence holds
the account (`keep-filled-slots.ts` withObservation, `remap-incident.ts` accountSentences). Alone, it stays.

Not needed in the sibling app as this change: its card has no Observation line and no `keep-filled-slots.ts`. Run
through Ask-bubbles' replay pack with its production flags (8 Nov 2026, invented name, this app's metric names left
out), the same wording gives "**Issue:** I need a corrective action made for under performance. <A> was below on …":
the whole request sentence, never a fragment, which QA's expected result allows. Its request lead has the same shape,
so a port would only change which words its Issue keeps.

Seen there and reported to QA separately: "I need a corrective action for under performance. <A> was below on …"
(without "made") gives "**Issue:** under performance", so the account is not on the Issue line.
