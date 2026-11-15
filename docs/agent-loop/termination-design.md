# Terminations in the agent loop: the model decides, code locks

QA's design (15 Nov 2026, under Pau's standing approval), merged in batch G (#1011). This page describes how it works. Use it for the Ask Bubbles port: port the mechanism, with Bubbles' own data (store for salon).

## Why

Batch G first tried to read termination intent with patterns, by widening `statesTermination`. Two reviews showed that this approach fails in both directions:

- **Missed terminations:** "After two prior written warnings, we are terminating her." read as history, so a real termination was missed.
- **False ticks:** "we fired her sister" and "she has been terminated at Target" read as this form's termination.

Each fix moved the errors around rather than removing them. So in the agent loop the **model** decides, taught by examples, and **code only locks** that decision on something it can check without guessing.

`statesTermination` (`src/lib/forms/termination-stated.ts`) is unchanged, still the version on main. Today's chat path keeps it.

## The pieces

### 1. The model decides

| Where | Input | Values |
|---|---|---|
| `propose_form` (Corrective Action) | `warning_level` | `verbal`, `written`, `termination` |
| `edit_form` (a draft) | `warning_type` | exactly `verbal`, `written` or `termination` (`exactWarningLevel`); anything else, such as "written termination" or "demotion", is refused |
| `propose_form` (Employee Exit Form) | `exit_type` | `resignation`, `termination` |
| `propose_form` (exit, termination) | `effective_date` | the date as the manager typed it ("11/28") |

The rules book (`src/lib/ai/agent-loop/rules-book.ts`, the "Termination" lines and "Exit forms") teaches the decision with the examples below.

### 2. The word lock

`src/lib/forms/termination-word.ts`:

```ts
export const TERMINATION_WORD = /\bterminat\w*|\bterm\s+(?:ca|c\/a)\b|\bfir(?:e|ed|es|ing)\b/i;
```

- A termination the model asks for is kept **only when the manager's own words carry a termination word**.
  - On a card (`propose_form`) and an exit, the lock reads this request's turns.
  - On an edit (`edit_form`), it reads the **current message only**, and a question never passes (`statesTerminationWordNow`).
  - Assistant text is never read.
- If the lock refuses, nothing is written. The result says `not_kept: ["warning_level"]` (or `"exit_type"`), and the rules book has the reply give the hedge line.
- The lock does not read meaning. "fire alarm" or "should I fire her?" on a card pass the lock by design, because the model decides those. "term", "determination" and "firecracker" do not pass.

### 3. The flag gate

Every lock, and Create's acceptance, is gated by `TERMINATION_STATED_TICKS_ENABLED` (`terminationStatedTicksEnabled()`). When it is off, nothing in the loop or at Create ticks Termination, whatever the model decides.

### 4. The card

- A locked decision sets `termination_stated: { approval, plan_closing }` on `propose_form`'s facts, in H12's shape. In the loop, `termination_stated` comes **only** from the model's locked decision. Main's reader never decides a loop card.
- The card carries:
  - `loopTermination: true`, which the client (`create-inline-form.ts`) posts to Create as `warningLevel: "termination"`;
  - `fromAgentLoop: true` on every loop card.

### 5. The server check at Create

`src/app/api/forms/instances/route.ts`:

- A card with `warningLevel: "termination"` on a Corrective Action ticks Termination only when **all** of these hold:
  - the flag is on;
  - the conversation's own user turns carry a termination word (`saysTerminationWord`), checked on the server.
- A loop card (`fromAgentLoop`) **never** runs today's reader at Create, so a forged or stale loop card cannot tick Termination by any other route.
- Cards from today's chat keep today's reader, unchanged.

### 6. Exits

- An exit the model decides is a termination, and the lock keeps, is filed as an "Immediate involuntary separation", with no Resignation Date and no policy.
- Its date (`lockedExitDate`, in `tools.ts`):
  1. the model's `effective_date`, kept only when the manager typed that same day in this request (`sameDate`);
  2. otherwise the stated last day (today's exit reader);
  3. otherwise today, with `dated_today`.
- A typed date with no year resolves to the day nearest today. On 12/30, "1/5" is next January. On 11/15, "fired her on 11/12" is this year.

### 7. The lines the reply uses

- **A termination:** "**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.", then `termination_stated.approval` ("Termination needs your DM/HR approval before you finalize."), then the plan's closing line.
- **A hedge, history, or no lock:** the level stays empty. The reply says, beside the warning-level line and never in its place:
  > If this form is a termination, tick Termination on the form yourself; it needs DM/HR approval before it's finalized.

  The same string is used on today's path (Coding-2, Sunny #1010 / Bubbles #927).

## The examples (the rules book teaches these)

**IS a termination for this form.** The model passes termination:

- "we're terminating her"
- "termination CA for Wren Halloway"
- "create a termination for Wren Halloway"
- "we fired her today"
- "my DM approved her termination"
- "after two prior warnings we are terminating her"
- "She has prior warnings, terminate her."
- "termination CA, she was previously warned twice"
- "she no call no showed her first day, terminate her"
- "I would like a termination CA for Wren Halloway"

**Is NOT a termination for this form.** The model passes no level, and the reply gives the hedge line:

- **A warning:** "if this happens again it will result in termination", "future violations may result in termination of employment", "Any further violations will result in termination."
- **History:** "she was fired from her last job", "she has been terminated at Target", "He has been terminated at his previous job", "Previously she has been terminated and rehired", "They fired him at his old salon", "she got fired her first week at Target", "She got a termination warning in March. Now she was late again, make a CA", "termination CA last year, now she's late again, write her up"
- **Another person:** "we fired her sister"
- **Intent:** "I told her we'd fire her", "I need to fire her", "I'd like to fire her", "we will fire her", "if this continues we will terminate her", "HR wants us to fire her"
- **Negation or a question:** "I don't think it should be a termination", "should I terminate her?"
- **Not an incident level:** "I can't select Termination" is a question about the form, so the model changes nothing.

**Exits that are resignations:** "resigned in lieu of termination", "quit after we talked about termination", "she was terminated at her last salon", "…last day 11/28. Not a termination."

## Tests

- `src/app/api/chat/replay-pack/nov15-agent-loop-termination-decision-cases.ts` has one case for every input above. It also covers:
  - the lock refusing inputs with no termination word;
  - a forged `loopTermination` card at Create;
  - the flag off;
  - the exit dates;
  - the no-values edit with a date after today.
- `src/lib/forms/termination-word.test.ts` covers the lock. `src/lib/ai/agent-loop/review-g.test.ts` covers exact levels, the Action Plan markers and `lockedExitDate`.
- With the lock removed, the lock cases fail. With Create's check removed, the forged-card case fails.
- The cases use a stand-in model, so they prove the lock, the card and Create, not the model's judgement. QA's live run with the real model, on all 34 inputs, covers that.

## Known items

- Today's path, which is not the loop, ticks "HR wants us to terminate her" at Create, because "wants us to" is not one of `statesTermination`'s hedges. This is logged by QA for later and unchanged by batch G.

## Porting to Ask Bubbles

Ask Bubbles has no agent loop yet. When the loop is ported, port these with it:

- `termination-word.ts`;
- the `propose_form` / `edit_form` inputs and locks;
- the flag gate;
- `loopTermination` / `fromAgentLoop` and Create's server check;
- `lockedExitDate`;
- the rules-book lines.

Use Bubbles' own store names and wording. Do not change Bubbles' `statesTermination`.
