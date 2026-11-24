# 2026-11-23: "show me <first>sexit" opens her one exit form

**Report (a live manager, 23 Nov 2026, Pau's review via QA).** The manager typed "show me <first>sexit": a possessive
with no apostrophe and no space before the next word.

What Sunny did:
- It asked twice whose form she meant.
- It then listed all 11 of the employee's forms.
- To the answer "11202026" it replied that 11/20 matched both a Coaching draft and the Resignation/Exit Form.

The one exit form on file never opened.

**What the trace showed.**
- `find_past_forms` was refused with `privacy_not_this_person`, and `open_form` was refused the same way twice. The
  run-together possessive, typed in lower case, named nobody.
- `open_form` was then refused twice with `which_form_not_chosen`.
- On the per-person path, `find_past_forms` narrowed by `form` only for coaching and corrective-action wording. "exit"
  kept every form.
- "11202026" read as no date.

**Fix (Ask Sunny, built on the round-2 integration head #1290).**
- `withRosterPossessives` reads a word that starts with a roster name, then "s", then three or more letters as that
  name's possessive and the next word ("<first>sexit" becomes "<first>'s exit"). It uses roster names only.
- The privacy guard reads a first or preferred name, as a whole word in any case, as naming the one roster person who
  has it. A first name two people share names nobody. Like the existing last-name rule, it only lets this person's forms
  through.
- On the per-person path, `find_past_forms` keeps only forms of the kind the request names. The kind comes from
  `formKindFromText`, the same reader the period listings use, matched against the template names. It is read from the
  model's `form`, or else from the manager's own words. With one exit form left, that form opens. With several, only
  they are listed.
- `which-form` reads an eight-digit date ("11202026") when it is a real calendar date.

- After Pau read the real chat ("she clearly said exit form, but sunny at the bottom keep asking coaching or exit"),
  two more parts were added:
  - **The kind named earlier holds** (`requestFormKind`). The kind is read from this message, then from the manager's
    earlier turns, back to where the request began. A request keeps running while each reply in between ended in a
    question. So "yes", "yes" and "11202026" keep the "exit" said first, and `find_past_forms` narrows on that kind too.
  - **The other kind is never the pick.** While a which-form question is open, a listed form of another kind is refused
    whenever a form of the named kind is listed. A date shared with a Coaching draft picks the exit form, and the model is
    told never to ask "coaching or exit?".
  Replay `nov23-show-firsts-exit-verbatim-four-turns` plays her four turns with an invented name.
- **Confirm, then open (Pau's brief, case 1).** The subject check's app-question rule (`replyNames`) and its
  earlier-turn rule (the antecedent) also take a first name that only this roster person holds. A "yes" to "do you want
  to see <First>'s … on file?" opens the form, where her real "yes" was refused twice.

**Ask Bubbles: port by Bubbles coder 2, from this PR (QA, 23 Nov 2026).** Bubbles' `main` (72404b3) already reads a
lower-case first name and its possessive (`firstNamed`). It has the other gaps:

1. It doesn't split a possessive run together with the next word.
2. Its per-person `form` narrowing covers only coaching and corrective actions, and it never reads a kind from the
   request's earlier turns.
3. `which-form` reads no eight-digit date and has no guard on the named kind.

The port carries the mechanism only: roster names, template-name kinds and calendar dates, never Sunny's names or
wording.
