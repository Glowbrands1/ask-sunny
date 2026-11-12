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

## Round 3, head 9cb9000fb (contains main b5f9d6ce1; tsc clean) — NO-GO

The new rule: an outline must (1) never mention the card's employee or the name typed in the request, (2) name someone
as the subject of an act, and (3) use the form's own section labels.

| Probe (card: Ilsa Varnholt) | isOutlineTurn |
|---|---|
| own account, Date/What happened (round 1) | false ✓ |
| own account naming a witness ("Marco called me …") | false ✓ |
| own account naming a coworker ("Jordan had to cover …") | false ✓ |
| own account, nickname, account labels (card Elizabeth, "Liz was …") | false ✓ |
| own account in **form labels**, written with **"she"** and naming a coworker: `Observation of Offense: she arrived 40 minutes late … on 11/3/26. Jordan had to open.\nAction Plan: review attendance with her` | **true ✗** |
| own account in form labels with a nickname (card Elizabeth; "Liz arrived …", "coach Liz"; the request didn't type "Liz") | **true ✗** |
| own account in form labels, no subject, naming a coworker ("Arrived 40 min late … Jordan covered the desk.") | false ✓ |
| Corisande outline, capitalised / lowercase | true / true ✓ |
| "same outline but with Ilsa's info" | true ✓ |

End to end (production flags; uncommitted probe; invented names). The turns were "create a corrective action for Ilsa
Varnholt", then "Observation of Offense: she arrived 40 minutes late to her opening shift on 11/3/26. Jordan had to open
the salon.\nAction Plan: Leadership will review the attendance policy with her":

| | OFF | ON |
|---|---|---|
| Card date | 2026-11-03 | **null** |
| Policy | Attendance, as you said | **none** |
| Drafting model's account | the request and her Observation / Action Plan | **the request only** |
| Reply | — | "I've kept Ilsa Varnholt's own details; nothing from the person in the pasted example goes on this card." (untrue) |

Class: REGRESSION. A manager can write her own account in the form's section labels, and "she" plus a coworker's name
is enough to drop it. Suggested direction: the outline's *subject* must be a named person other than her. A pronoun
subject ("she arrived", "he left") refers to the card's employee, so keep the turn. And a name the roster maps to the
card's employee (a nickname or preferred first name) counts as hers.

## Round 4, head 757e389f2 — GO

Rule: an outline needs the form's own labels, must never mention her name or the name typed in the request, must have
no she/he/they in its Observation, and the Observation's first sentence must be about a named person (first and last
name) who isn't her. Merged onto main 05576461: clean, tsc clean.

Probes (card Ilsa Varnholt). These are **kept as her account**: Date/What happened; coworker named; witness named;
form labels + "she" + coworker; form labels + nickname (card Elizabeth); a witness's full name as subject ("Jordan Pike
reported …"); a full-name coworker opening the salon; no subject; surname only. These are **outlines**: "Corisande Velt
arrived …" and "same outline but with Ilsa's info". **Not caught** (as today; production doesn't catch these either):
an outline naming the other person by first name only ("Corisande arrived …") or in lowercase.

1 OFF + 1 ON, full suite, production flags in the env:

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,935 | 20,540 | 1,261 |
| ON  | 21,935 | 20,538 | 1,263 |

- replay `nov11-17i-outline-on-open-proposal` OPEN arm: it now holds. The reply gains "I've kept **Ilsa
  Varnholt**'s own details; nothing from the person in the pasted example goes on this card.", and the card keeps step
  (a)'s date and Attendance p.14. INTENDED. Parity child: INTENDED-HARNESS.
- `outline-on-proposal.test.ts` "off: the request is as sent" and "… off, as sent": these fail with the flag on in the
  env because the off arms don't force the flag off. INTENDED-HARNESS; tidy-up for Coding-6.
- Replay text: **1 record differs** (the target). The g4-802 own-account cases, sf-s21,
  nov8-second-request-sf-s21-template-one-request and nov8-second-request-sf-s22-one-request are **unchanged**.
  0 REGRESSION.
- Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.
- On main 1ecadf923 the PR conflicts in flags-off-parity and chat-quality-flags (the flag lists): a rebase is needed.

**GO.** The case that now holds is `nov11-17i-outline-on-open-proposal`.
