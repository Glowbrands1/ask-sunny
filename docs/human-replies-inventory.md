# Human replies — wording inventory (26 Oct 2026)

The owner's rule: "humanize it". Replies should sound like a coordinator
talking to a manager. This lists every assistant sentence template in the
form flow, where it lives, and a proposed human version. Proposals keep every
fact and every required notice. They add no new facts.

**Protected** files need the owner's approval for each edit. Those rows are
proposals only. Nothing in a protected file is changed by `HUMAN_REPLIES_ENABLED`.
Line numbers are Ask Sunny `main` at f43301d. Ask Bubbles has the same
sentences in `src/lib/ai/form-proposal.ts` (store for salon), at the lines given
in the Bubbles column where they differ.

## A. Repetition (done in code, outside protected files)

`src/lib/ai/human-replies.ts`, called from `src/app/api/chat/route.ts`, behind
`HUMAN_REPLIES_ENABLED` (default off, same name in Ask Bubbles). The first card
turn for an employee and form is left exactly as built. On each later turn for
the same form and employee:

- the opener ("I'll draft a … from what you've described, and check the
  applicable company policy …", "Here is what I would put on a …", "Everything I
  need is here …") is replaced by one line on what this turn changed, read from
  the card's own fields: "Got it — the date's 10/14." When the turn changed
  nothing we can name, it says "Got it — here's the card.";
- a paragraph or `**Label:**` line the manager already read in this chat is
  left out (the policy line, the warning read-back, "You'll set … on the form");
- the long "Create the draft here … nothing is saved to anyone's file until you
  do." notice becomes "Nothing's saved until you tap **Create draft**." It is on
  every card turn, short;
- questions are never removed or reworded (readers such as `payroll-deduct.ts`,
  `salon-reply.ts`, `question-not-form.ts` read the last assistant turn), and
  neither are "**Nothing has been created**" and "You haven't told me what
  happened yet".

The card (`formProposal`) is returned exactly as built.

## B. Protected — `src/lib/ai/form-proposal.ts` (needs owner approval)

| Line | Today | Proposed |
|---|---|---|
| 2451 (Bubbles 3088) | I'll draft a **{form}** for **{name}** from what you've described, and check the applicable company policy before anything policy-related goes on it. | Here's the **{form}** for **{name}**. I'll check the policy manual before citing anything. |
| 2621 (Bubbles 3284) | I'll draft a **{form}** for **{name}** from what you've described, and check the applicable JB & Associates policy before anything policy-related goes on it. | Here's the **{form}** for **{name}**. I'll check JB & Associates policy before citing anything. |
| 2252 (Bubbles 2861) | Here is what I would put on a **{form}**. | Here's the **{form}**. |
| 2264 (Bubbles 2885) | Everything I need is here, drawn from your message(s) above. | I have everything I need from what you wrote. |
| 2301 | {I have the employee}. Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do. | Got the employee. It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| 2302 | {I have the employee} and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do. | Got the employee and salon. Nothing's saved until you tap **Create draft**. |
| 1885, 2560, 2635 | Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do. | It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| 1886, 2561, 2636 | Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do. | Tap **Create draft** when you're ready. Nothing's saved until you do. |
| 1887 | **Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form. | **Nothing's been created yet.** To file it today, use Create a Form. |
| 2335, 2562, 2637 | **Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet. | **Nothing's been created yet.** I can't make this form in chat yet. |
| 2317 | **Nothing has been created yet.** Choose the salon below, or tell me which one, and you can create the draft here. | **Nothing's created yet.** Pick the salon below, or tell me, and you can create the draft. |
| 2318 | **Nothing has been created yet.** Tell me which salon, and you can create the draft here. | **Nothing's created yet.** Which salon? Then you can create the draft. |
| 2476 | **Type of Warning:** {Verbal Warning}, as you said — I'll tick it on the form. Tell me if that should change. | **Type of Warning:** {Verbal Warning}. I'll tick it on the form. |
| 2489 | **Prior actions:** {list}, as you said. I'll list it/them on the form — tell me if that should change. | **Prior actions:** {list}. I'll list them on the form. |
| 2503 | **On file in Form Monitoring for {name}:** {list}. I'll list it/them under prior coaching and corrective action on the form — remove any that shouldn't count. | **Already on file for {name}:** {list}. I'll add them as prior actions — remove any that shouldn't count. |
| 2512, 2627 | You'll set {the verbal/written warning level} on the form — I won't guess at it. | You can set {the warning level} on the form. |
| 2531 | Is payroll deduct applicable? **No** — tell me if that should change. | Payroll deduct: **No**. |
| 2536 | One more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you. | One more: **is payroll deduct applicable?** Yes or no — here or on the form. ¹ |
| 2549 | **Payroll deduction amount** **{amount}** — tell me if that should change. | **Payroll deduction amount:** **{amount}**. |
| 2381 | Who is this **{form}** for? Give me their name and I'll draft it from what you've told me — you can set the warning level and anything else on the form itself. | Who's this **{form}** for? |
| 2581, 1859 | Who is this **{form}** for? Give me their name and I'll draft it from what you've told me. | Who's this **{form}** for? |
| 2378, 2578, 1857, 2662 | Which of them is this **{form}** for — **A** or **B**? Tell me and I'll draft it from what you've already described. | Which one is it for — **A** or **B**? |
| 2696 | Who is this form for? Tell me the employee's full name. | Who's it for? Full name, please. |
| 2698 | To draft a form, I'll need a few details first: … Could you please provide these? | To draft it I need: … Send what you have. |
| 2714 | I won't choose which salon this belongs to. Which salon is this about? | Which salon is this about? |
| 2708 | **{X}** isn't a salon on your assignment, so I can't file a form against it. Which of your salons is this about? | **{X}** isn't one of your salons. Which of yours is it? |
| 2716 | I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to. | I can't confirm a salon you're assigned to, so I left it off. |
| 1844 | Let's fill out the **{form}**. Send me what you have in one message and I'll put each detail in the right place: | Let's do the **{form}**. Send what you have in one message: |
| 1877 | To finish it I still need {x}. Send them here in one message, or fill them in on the form — I won't guess at any of them. | Still need {x}. Send them here or fill them in on the form. |
| 1878 | That covers every detail the form asks for. | That's everything the form asks for. |
| 889 | I took **{name}** from earlier in this conversation — if this form is for somebody else, tell me who. | I used **{name}** from earlier. If it's someone else, tell me who. |
| 594 | Your role cannot create a **{form}**, so I will not propose one. | Your role can't create a **{form}**. |
| 575 | That form is not published in Ask Sunny yet, so I will not stand in for it with a different one. | That form isn't published in Ask Sunny yet. |

¹ 2536's wording is matched by `payroll-deduct.ts` readers through
`PAYROLL_DEDUCT_LABEL` ("Is payroll deduct applicable?"). The proposal keeps
that label's words; the label itself (protected `payroll-deduct.ts:36`) is not
changed.

## C. Protected — other files (needs owner approval)

| File:line | Today | Proposed |
|---|---|---|
| `src/lib/forms/location-scope.ts:262` | Your account covers every salon rather than one, so Ask Sunny will not put a salon on this form. | This form won't name a salon, since you cover them all. |
| `src/features/chat/message-bubble.tsx:622` (UI, not protected; listed for the owner) | Proposal — nothing created / Superseded — nothing created | Draft preview — not saved yet / Replaced by the card below |

## D. Not protected — owned by another Code session's logic (wording only, proposed)

| File:line | Today | Proposed | Logic owner |
|---|---|---|---|
| `src/lib/forms/ca-policy.ts:579, 582` | **Policy:** {X}, as you said. I'll quote that section from the current policy manual on the draft. | **Policy:** {X}. I'll quote the manual's section on the draft. ("as you said" only when the manager named it) | Code 4 (`POLICY_AS_YOU_SAID_MANAGER_ONLY_ENABLED`) |
| `src/lib/forms/ca-policy.ts:520` | **Policy:** {heading}, as you said — the policy manual's section on page {p}. I'll quote it on the draft under **{box}**. | **Policy:** {heading} (manual, page {p}). I'll quote it under **{box}**. | Code 4 |
| `src/lib/forms/ca-policy.ts:571` | **Policy:** Attendance — missing {the meeting} is an absence from a scheduled shift. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies. | **Policy:** Attendance — missing {the meeting} counts as an absence. I'll quote it; tell me if it's another policy. | Code 4 |
| `src/lib/forms/ca-policy.ts:585` | … as you said. The policy manual has no single section to quote for it, so Direct policy is left for you to complete. | **Policy:** {X}. The manual has no one section for it, so fill in Direct policy yourself. | Code 4 |
| `src/lib/forms/ca-policy.ts:589` | **Policy:** this reads as **Standards of Conduct** — {what}. I'll check it against the current policy manual and quote that section on the draft; if the manual doesn't support it, I'll leave the policy for you. Tell me if a different policy applies. | **Policy:** sounds like **Standards of Conduct** ({what}). I'll quote it if the manual backs it — tell me if not. | Code 4 |
| `src/lib/forms/ca-policy.ts:554` | **Policy source:** "{manual}" — requires owner confirmation as Ask Sunny's approved policy manual. I'll cite it with its section and page; check the wording against your current manual before you finalize. | **Policy source:** "{manual}" isn't confirmed as our manual yet. Check the wording before you finalize. | Code 4 |
| `src/lib/forms/corrective-action-intake.ts:520` (`NO_INCIDENT_NOTE`, also a marker) | **You haven't told me what happened yet**, so I can't cite the policy manual — the draft will come back without the policy section and page. You can create it now and fill it in yourself, or tell me here what happened and I'll draft it (or redraft the form you created) with the manual's section and page cited. | **You haven't told me what happened yet.** Tell me and I'll cite the manual, or create it now and fill it in. | Code 7 (incident text); the marker string must move with it |
| `src/lib/forms/payroll-amount-field.ts:29` (`PAYROLL_AMOUNT_QUESTION`, also a marker) | One more question: **Payroll deduction amount**? Tell me the figure here, or type it on the form — I won't take it from the policy. | How much is the **payroll deduction**? Here or on the form. | Code 2; it is the "already asked" marker |
| `src/lib/forms/exit-intake.ts:102` | Who is this **{form}** for? Give me their name and I'll fill in what you've already described. | Who's this **{form}** for? | dates/exit session |
| `src/lib/forms/exit-intake.ts:251` | (same global-salon notice as B 2560) | (same as B 2560) | dates/exit session |
| `src/lib/forms/global-salon-ask.ts:21` | Which salon is this about? The card is ready — choose the salon before you create the draft, so it is not filed with no salon. | Which salon is this about? Pick it before you create the draft. (Pau approved today's wording 24 Oct) | — |
| `src/lib/ai/form-full-remap.ts:1061, 1064–1083` | Here is the {form}. / **Policy:** {X}, as you said / **Type of warning:** {X}, as you said / **Payroll deduct:** No, as you said | Here's the {form}. / "as you said" only where the manager said it (1078 says it for any model-read policy while `REMAP_INCIDENT_FIX_ENABLED` is off) | Code 4 |
| `src/lib/ai/prompts.ts:783` (model rule) | "…say the form has not been created yet and ask them to request it by name and employee — for example "create a coaching form for Dana Moss"…" | This is the source of "I can't create the form myself in this message… say: create a coaching form for X". The fix is routing (the turn should reach the form path), not wording. | short-commands session |

"…doesn't tell me enough…" is not in either app's source. It is the grounded
model's own wording, so it is a prompt question, not a template.
