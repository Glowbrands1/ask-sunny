# Editing a finalized form — as a new draft of it

## The feedback

A manager asked Sunny to "change exit for ashley rogers", then to "duplicate
exit for ashley rogers and change date notice given to 9-27-26", then to "show
draft of exit". Every answer said a created form can't be changed. The
finalized card said "A correction is a revision", but nothing let the manager
make one: `POST /api/forms/instances/[id] {action: "revise"}` existed, and no
screen called it. Form Monitoring has no editor at all.

## What changed

**A finalized form is never written.** Changing one opens a **revision**:
`reviseInstance` copies every value except signatures into a new draft that
points back at the original (`revises_instance_id`) and marks the original
`revised`. The finalized record stays exactly as it was finalized, on file.

Three ways in:

1. **The form card.** A finalized card now has **Edit as new draft**. Pressing
   it opens the revision, and the card becomes that draft, editable with the
   usual Save and Finalize. The pointer on the chat message moves to the
   draft, so a refresh reopens the draft. A revised card says it was replaced
   and offers **Open newer version**.
2. **A correction typed in chat** against a finalized form in the conversation
   ("change her last day to 9/16", "no payroll deduction", a coaching redraft)
   opens the new draft and makes the correction there, instead of refusing.
   (`chat-correction.ts`, `chat-revision.ts`, via `editable-draft.ts`.)
3. **Asking for a form on file by name and employee** — "change exit for
   ashley rogers", "edit the coaching form for Dana Moss", "show draft of
   exit" — finds it (the conversation's form when it is the one meant,
   otherwise the newest active one the actor may see, filtered exactly as Form
   Monitoring is) and puts its card in the thread: a draft as it is, a
   finalized one as a new draft, a revised one followed to its newer version.
   A change in the same sentence ("… and change date notice given to
   9-27-26") is then made on the draft. (`chat-reopen.ts`,
   `reopen-request.ts`.)

## What it never does

- Create a new form. "Create", "make a", "start a", "another", "a new … form"
  and "pull up a …" are left to the proposal flow, and so is any turn while a
  proposal for that form is still waiting to be created.
- Answer a question as if it were a request. "How do I change an exit form?"
  and "Can I edit a finalized coaching form?" go to the knowledge base.
- Fork a second revision. Asking twice lands on the draft the first request
  opened.
- Skip authorization. Every record touched is re-authorized with the `edit`
  action — the template's own permission and the salon scope.
