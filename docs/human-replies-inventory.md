# Human replies — wording inventory (26 Oct 2026)

The owner's rule: "humanize it". Replies should sound like a coordinator
talking to a manager. Everything below is behind `HUMAN_REPLIES_ENABLED`
(default off, same name in Ask Bubbles; the card badge reads
`NEXT_PUBLIC_HUMAN_REPLIES_ENABLED`). With the flag off, every reply is the
same as on `main`.

The owner chose the phrase-table option through QA on 26 Oct ("4.ok"). The
sentences are rewritten on the way out, in `src/lib/ai/human-replies.ts`
(`PHRASES`), and **no protected file is edited**. Section C lists the same
rewrites as edits to `form-proposal.ts`, for the owner to approve if he
would rather have the wording at its source.

Rules the table keeps:

- No new facts, and no required notice dropped. The save notice is on every
  card, short: "Nothing's saved until you tap **Create draft**."
- A question keeps the words its readers match: "Who is this **…** for?",
  "Which of them is this **…** for — …?", "Is payroll deduct applicable?",
  "Which salon is this about?", the numbered intake list, and
  `PAYROLL_AMOUNT_QUESTION`. Only the sentences around the question change.
  `human-replies.test.ts` replays ask → answer → next turn through
  `payroll-deduct.ts`, `payroll-amount-field.ts`, `salon-reply.ts`,
  `warning-level.ts` and `question-not-form.ts`.
- "**Nothing has been created" and "You haven't told me what happened yet"
  keep their opening words, because they are markers.
- Whether a line says "as you said" is not decided here (Code 4).
- Ask Sunny's wording stays in Ask Sunny: "JB & Associates policy", "salon",
  "Form Monitoring" and "Ask Sunny" are not in the Ask Bubbles table.

## A. Repetition

On a later card turn for the same form and employee:

- the opener becomes one line on what this turn changed, read from the card's
  own fields: "Got it — the date's 10/14.", "Got it — no payroll deduct.",
  "Got it — it's a written warning.", and "Got it — here's the card." when
  the turn names nothing the card has a field for;
- a paragraph, `**Label:**` line or `·` read-back the manager has already seen
  in this chat is left out;
- the save notice is the short one alone;
- questions are never left out.

## B. The phrase table (implemented)

| Where it is built | Today | Now |
|---|---|---|
| `form-proposal.ts:2451` | I'll draft a **{form}** for **{name}** from what you've described, and check the applicable company policy before anything policy-related goes on it. | Here's the **{form}** for **{name}**. I'll check the policy manual before citing anything. |
| `form-proposal.ts:2621` (EPP) | … check the applicable JB & Associates policy … | Here's the **{form}** for **{name}**. I'll check JB & Associates policy before citing anything. (Ask Bubbles: "the policy manual") |
| `form-proposal.ts:2252` | Here is what I would put on a **{form}**. | Here's the **{form}**. |
| `form-full-remap.ts:1061` | Here is the {form}. | Here's the {form}. |
| `form-proposal.ts:2264` | Everything I need is here, drawn from your message(s) above. | I have everything I need from what you wrote. |
| `form-proposal.ts:2301` | I have the employee. Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do. | Got the employee. It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `form-proposal.ts:2302` | I have the employee and the salon. Create the draft here … until you do. | Got the employee and salon. Nothing's saved until you tap **Create draft**. |
| `form-proposal.ts:2302` (team) | This one is for the whole team, and I have the salon. Create the draft here … | It's for the whole team, and I have the salon. Nothing's saved until you tap **Create draft**. |
| `form-proposal.ts:1885` | Your account covers every salon, so the form won't name one unless you did. Create the draft here … | It won't name a salon unless you did, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `form-proposal.ts:2560, 2635`, `exit-intake.ts:251` | Your account covers every salon, so this form won't name one. Create the draft here … | It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `form-proposal.ts:1886, 2561, 2636`, `exit-intake.ts:252` | Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do. | Nothing's saved until you tap **Create draft**. |
| `location-scope.ts:262` | Your account covers every salon rather than one, so Ask Sunny will not put a salon on this form. | This form won't name a salon, since you cover them all. |
| `form-proposal.ts:2335, 2562, 2637` | **Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet. | **Nothing has been created.** I can't make this form in chat yet. |
| `form-proposal.ts:1887` | **Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form. | **Nothing has been created.** To file it today, use Create a Form. |
| `form-proposal.ts:2317` | **Nothing has been created yet.** Choose the salon below, or tell me which one, and you can create the draft here. | **Nothing has been created yet.** Pick the salon below, or tell me, and you can create the draft. |
| `form-proposal.ts:2318` | **Nothing has been created yet.** Tell me which salon, and you can create the draft here. | **Nothing has been created yet.** Tell me the salon and you can create the draft. |
| `form-proposal.ts:2476` | **Type of Warning:** {Verbal Warning}, as you said — I'll tick it on the form. Tell me if that should change. | **Type of Warning:** {Verbal Warning}, like you said. I'll tick it on the form. |
| `form-proposal.ts:2489` | **Prior actions:** {list}, as you said. I'll list it/them on the form — tell me if that should change. | **Prior actions:** {list}, like you said. I'll list it/them on the form. |
| `form-proposal.ts:2503` | **On file in Form Monitoring for {name}:** {list}. I'll list it/them under prior coaching and corrective action on the form — remove any that shouldn't count. | **Already on file for {name}:** {list}. I'll add it/them as prior actions — remove any that shouldn't count. |
| `form-proposal.ts:2512` | You'll set {x} on the form — I won't guess at it. | You can set {x} on the form. |
| `form-proposal.ts:2627` | You'll set {x} on the form — I won't guess at them, and they don't hold the plan up. | You can set {x} on the form; they don't hold the plan up. |
| `form-proposal.ts:2531` | Is payroll deduct applicable? **No** — tell me if that should change. | Payroll deduct: **No**. |
| `form-proposal.ts:2549` | **Payroll deduction amount** **{amount}** — tell me if that should change. | **Payroll deduction amount:** **{amount}**. |
| `form-proposal.ts:2536` | One more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you. | **Is payroll deduct applicable?** Yes or no — here or on the form. |
| `form-proposal.ts:2381, 2581`, `exit-intake.ts:102` | Who is this **{form}** for? Give me their name and I'll draft it from what you've told me … | Who is this **{form}** for? |
| `form-proposal.ts:2378, 2578`, `exit-intake.ts:100` | Which of them is this **{form}** for — **A** or **B**? Tell me and I'll draft it from / fill in what you've already described. | Which of them is this **{form}** for — **A** or **B**? |
| `form-proposal.ts:2696` | Who is this form for? Tell me the employee's full name. | Who is this form for? Full name, please. |
| `form-proposal.ts:2698` | To draft a form, I'll need a few details first: … Could you please provide these? | To draft it, I need: … Can you send those? |
| `form-proposal.ts:2714` | I won't choose which salon this belongs to. Which salon is this about? | Which salon is this about? |
| `form-proposal.ts:2708` | **{X}** isn't a salon on your assignment, so I can't file a form against it. Which of your salons is this about? | **{X}** isn't one of your salons. Which of your salons is this about? |
| `form-proposal.ts:2716` | I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to. | I can't confirm a salon you're assigned to, so I left it off. |
| `corrective-action-intake.ts:757` | Great, I can help you create a **{form}**. To get started, please provide me with these details: | Sure — for the **{form}** I need: |
| `corrective-action-intake.ts:769` | Once I have that I'll prepare the {form} and check the applicable company policy before anything policy-related goes on it. | Then I'll draft it and check the policy manual. |
| `corrective-action-intake.ts:776` | I have most of it. Still missing: | Almost there. Still need: |
| `form-proposal.ts:1844` | Let's fill out the **{form}**. Send me what you have in one message and I'll put each detail in the right place: | Let's do the **{form}**. Send what you have in one message: |
| `form-proposal.ts:1877` | To finish it I still need {x}. Send them here in one message, or fill them in on the form — I won't guess at any of them. | Still need {x}. Send them here or fill them in on the form. |
| `form-proposal.ts:1878` | That covers every detail the form asks for. | That's everything the form asks for. |
| `form-proposal.ts:889` | I took **{name}** from earlier in this conversation — if this form is for somebody else, tell me who. | I used **{name}** from earlier. If it's someone else, tell me who. |
| `form-proposal.ts:594` | Your role cannot create a **{form}**, so I will not propose one. | Your role can't create a **{form}**. |
| `form-proposal.ts:575` | That form is not published in Ask Sunny yet, so I will not stand in for it with a different one. | That form isn't published in Ask Sunny yet. |
| `ca-policy.ts:571` | … I'll quote that section from the current policy manual on the draft; tell me if a different policy applies. | … I'll quote it on the draft; tell me if it's another policy. |
| `ca-policy.ts:579, 582` | … I'll quote that section from the current policy manual on the draft. | … I'll quote the manual's section on the draft. |
| `ca-policy.ts:585` | The policy manual has no single section to quote for it, so Direct policy is left for you to complete. | The manual has no one section for it, so fill in Direct policy yourself. |
| `corrective-action-intake.ts:520` (`NO_INCIDENT_NOTE`) | **You haven't told me what happened yet**, so I can't cite the policy manual — the draft will come back without the policy section and page. You can create it now and fill it in yourself, or tell me here what happened and I'll draft it (or redraft the form you created) with the manual's section and page cited. | **You haven't told me what happened yet.** Tell me and I'll cite the manual's section and page, or create it now and fill it in yourself. |
| `prior-coaching-optional.ts:70` | Prior coaching is optional. No finalized record is in this app and no note was given, so the line stays blank. The draft can still be created. | Prior coaching is optional — none on file and none given, so it stays blank. |
| `prior-coaching-optional.ts:65` | Prior coaching already listed from Form Monitoring stays on the form. Drafts are not used. The draft can still be created. | Prior coaching on file stays on the form (drafts don't count). |
| `prior-coaching-optional.ts:63` | Prior coaching on file (finalized only): {list}. Drafts are not used. The draft can still be created. | Prior coaching on file: {list} (finalized only; drafts don't count). |
| `prior-coaching-optional.ts:67` | Prior coaching note: {note}. No finalized record was required. The draft can still be created. | Prior coaching note: {note}. |
| `chat-redraft.ts:119–131` | Redrafted the **{form}** for **{name}** from what you described. / **Direct policy from official manual** now quotes the manual and cites its section and page. / Give it a read below before you finalize. | Updated the draft of the **{form}** for **{name}** — the policy now quotes the manual, with its section and page. / Have a look below before you finalize. |
| grounded answer (model) | The knowledge base here is just … — there's nothing in it about {question}. | That's not something I can help with here — I can help with forms and the policy manual. |
| `message-bubble.tsx:622` (badge) | Proposal — nothing created / Superseded — nothing created | Draft preview — not saved yet / Replaced by the card below |

Kept word for word: `PAYROLL_AMOUNT_QUESTION` and the numbered intake list
(both are matched on the next turn), and `GLOBAL_SALON_ASK` (the owner
approved its wording on 24 Oct).

## C. PROPOSED protected edits (owner approval needed)

The same rewrites as section B, made at the source instead of on the way
out, for the owner to approve line by line. Nothing here has been edited.

| File:line | Proposed new text |
|---|---|
| `src/lib/ai/form-proposal.ts:2451` | Here's the **${proposal.templateName}** for **${proposal.employeeName}**. I'll check the policy manual before citing anything. |
| `src/lib/ai/form-proposal.ts:2621` | Here's the **${proposal.templateName}** for **${proposal.employeeName}**. I'll check JB & Associates policy before citing anything. |
| `src/lib/ai/form-proposal.ts:2252` | Here's the **${proposal.templateName}**. |
| `src/lib/ai/form-proposal.ts:2264` | I have everything I need from what you wrote. |
| `src/lib/ai/form-proposal.ts:2301` | ${who === "I have the employee" ? "Got the employee" : "It's for the whole team"}. It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `src/lib/ai/form-proposal.ts:2302` | Got the employee and salon. / It's for the whole team, and I have the salon. — then: Nothing's saved until you tap **Create draft**. |
| `src/lib/ai/form-proposal.ts:1885` | It won't name a salon unless you did, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `src/lib/ai/form-proposal.ts:2560, 2635` | It won't name a salon, since you cover them all. Nothing's saved until you tap **Create draft**. |
| `src/lib/ai/form-proposal.ts:1886, 2561, 2636` | Nothing's saved until you tap **Create draft**. |
| `src/lib/ai/form-proposal.ts:1887` | **Nothing has been created.** To file it today, use Create a Form. |
| `src/lib/ai/form-proposal.ts:2335, 2562, 2637` | **Nothing has been created.** I can't make this form in chat yet. |
| `src/lib/ai/form-proposal.ts:2317` | **Nothing has been created yet.** Pick the salon below, or tell me, and you can create the draft. |
| `src/lib/ai/form-proposal.ts:2318` | **Nothing has been created yet.** Tell me the salon and you can create the draft. |
| `src/lib/ai/form-proposal.ts:2476` | **Type of Warning:** ${level}, like you said. I'll tick it on the form. |
| `src/lib/ai/form-proposal.ts:2489` | **Prior actions:** ${priorActions.join("; ")}, like you said. I'll list ${it/them} on the form. |
| `src/lib/ai/form-proposal.ts:2503` | **Already on file for ${proposal.employeeName}:** ${list}. I'll add ${it/them} as prior actions — remove any that shouldn't count. |
| `src/lib/ai/form-proposal.ts:2512` | You can set ${outstanding.join(" and ")} on the form. |
| `src/lib/ai/form-proposal.ts:2627` | You can set ${named.join(" and ")} on the form; they don't hold the plan up. |
| `src/lib/ai/form-proposal.ts:2531` | Payroll deduct: **${Yes/No}**. |
| `src/lib/ai/form-proposal.ts:2536` | **${PAYROLL_DEDUCT_LABEL}** Yes or no — here or on the form. |
| `src/lib/ai/form-proposal.ts:2549` | **${PAYROLL_AMOUNT_LABEL}:** **${proposal.payrollDeductAmount}**. |
| `src/lib/ai/form-proposal.ts:2381, 2581` | Who is this **${templateName}** for? |
| `src/lib/ai/form-proposal.ts:2378, 2578` | Which of them is this **${templateName}** for — ${names}? |
| `src/lib/ai/form-proposal.ts:2696` | Who is this form for? Full name, please. |
| `src/lib/ai/form-proposal.ts:2698` | To draft it, I need:\n\n${numbered}\n\nCan you send those? |
| `src/lib/ai/form-proposal.ts:2708` | **${proposal.namedLocationOutOfScope}** isn't one of your salons. Which of your salons is this about? |
| `src/lib/ai/form-proposal.ts:2714` | Which salon is this about? |
| `src/lib/ai/form-proposal.ts:2716` | I can't confirm a salon you're assigned to, so I left it off. |
| `src/lib/ai/form-proposal.ts:1844` | Let's do the **${proposal.templateName}**. Send what you have in one message: |
| `src/lib/ai/form-proposal.ts:1877` | Still need ${joinList(…)}. Send them here or fill them in on the form. |
| `src/lib/ai/form-proposal.ts:1878` | That's everything the form asks for. |
| `src/lib/ai/form-proposal.ts:889` | I used **${proposal.employeeName}** from earlier. If it's someone else, tell me who. |
| `src/lib/ai/form-proposal.ts:594` | Your role can't create a **${match.name}**. |
| `src/lib/ai/form-proposal.ts:575` | That form isn't published in Ask Sunny yet. |
| `src/lib/forms/location-scope.ts:262` | This form won't name a salon, since you cover them all. |

## D. Reported, not changed (other sessions own the logic)

- `form-full-remap.ts:1078` prints "**Policy:** {model-read section}, as you
  said" for any policy the remap model read while `REMAP_INCIDENT_FIX_ENABLED`
  is off (Code 4).
- On production flags, a bare "no" after "Is payroll deduct applicable?" is not
  read, and the card asks again (main, flag off; `human-replies-e2e.test.ts`
  replays it). With the bundle's flags it is read (Code 2).
- Observation of Offense picks up commands ("late opening the salon today. no
  deduct", "skipped a tour today. date 10/14") (Code 7).
- `prompts.ts:783` is behind "I can't create the form myself in this message";
  the fix is routing the turn to the form path (short-commands session).
- The CA intake list asks for every item on a short ask; which items are
  missing is the intake's decision (form-intake session). Its lead and closing
  sentences are rewritten above.
