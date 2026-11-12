# Gate-Sunny-3 — #875 OUTLINE_ON_OPEN_PROPOSAL_ENABLED — NO-GO (head 8caf2b72f)

## Round 1, head 60411d57: held

QA held it after Gate-Bubbles-4's NO-GO on the twin (G4-802). My probes found the same problem in Sunny:
`isOutlineTurn` was true for the manager's own labelled facts ("Date: 11/3/26\nWhat happened: …", "Time: 9am\nShift:
opening\nshe was late") and for "use this format for her" / "make it look like this template".

## Round 2, head 8caf2b72f (Coding-6; port of B#802 7bfbae15ee)

- Merged onto Sunny main `a7b9ef69`. The conflicts were in route.ts, flags-off-parity.test.ts and
  chat-quality-flags.ts; I kept both sides. One overlapping hunk in chat-quality-flags.ts needed the closing `}` of
  `draftWroteNothingNoticeEnabled` restored. After that, tsc is clean.
- The round-1 probes now pass (not outline turns): own-labelled, own-labelled-time, use-this-format, look-like-template.
  `same outline but with Ilsa's info` is still an outline turn, as intended.

### New false positive: the manager's own account that names a coworker, a witness or a nickname

The new rule is that a labelled paste counts as no account when it "names a person other than the card's employee"
(`NAMED_ACT`: a capitalised word followed by was/had/called/…). A manager's own account often names other people:

| Probe (card: Ilsa Varnholt; the account is all hers) | isOutlineTurn |
|---|---|
| `Date: 11/3/26\nWhat happened: Ilsa was 40 minutes late. Marco called me at 9:10 to say the salon was still locked` | **true** |
| `Date: 11/3/26\nWhat happened: Ilsa did not show up. Jordan had to cover her shift` | **true** |
| `Date: 11/3/26\nWhat happened: Liz was 40 minutes late` (card: Elizabeth Varnholt) | **true** |
| `Observation: a client complained\nDetails: Mrs Parker said Ilsa was rude at the front desk` | false |
| Corisande outline (the 17i case) | true (intended) |
| Same outline, lowercase (`corisande arrived …`) | false (the 17i bug stays open for this wording) |

End to end in the replay pack (production flags; an uncommitted probe case; the names are invented). The turns were
"create a corrective action for Ilsa Varnholt", then
"Date: 11/3/26\nWhat happened: Ilsa was 40 minutes late to her opening shift. Jordan had to cover the front desk until
she arrived":

| | OFF (production) | ON (+OUTLINE_ON_OPEN_PROPOSAL) |
|---|---|---|
| Card date | 2026-11-03 | **null** |
| Policy | Late Opening, p.15 | **none** |
| Observation | the account | **missing**; Action Plan generic ("the applicable company policy") |
| Reply | — | **"I've kept Ilsa Varnholt's own details; nothing from the person in the pasted example goes on this card."** (untrue: there was no pasted example) |
| Drafting model's "WHAT THE MANAGER DESCRIBED" | the request and the account | **the request only** |

Class: **REGRESSION**. The manager's own facts are lost from the card and the draft, and the reply claims otherwise.

I didn't run the full 1+1 on this head: the probe settles the verdict.

## Verdict

**NO-GO** on 8caf2b72f. Suggested direction for Coding-6:
- Count a paste as an outline only when the *subject* of its account (the person the Observation is about, e.g. the
  first named actor or the name before "arrived/completed/failed …" in the first labelled line) is someone else. A
  second person anywhere in the text shouldn't make it an outline.
- Or require the outline's labels to be the form's own field labels (Observation of Offense / Action Plan …), not
  Date / What happened / Time.
- Add these probes as unit and replay negatives: a coworker who covered, a witness who called, and a nickname.

The Bubbles twin likely needs the same change.
