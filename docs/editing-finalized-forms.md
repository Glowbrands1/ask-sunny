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
`reviseInstance` copies every value and the follow-up (date, and completion if
there was one) into a new draft that points back at the original
(`revises_instance_id`). Signatures are never stored — they are signed on
paper — so the new version is printed and signed like any other.

**The original is replaced only when the revision is finalized.** Opening the
draft changes nothing about the original: not its status, not its history.
`finalizeInstance` marks it `revised` (with a `revised` event naming the
revision) when the revision is finalized. Deleting the draft instead is a
complete undo. One draft revision per form is open at a time; asking again
returns it.

**The follow-up is counted once.** While the revision is a draft the original
keeps the tracking and the draft reads `drafted`; once the original is
`revised` it reads `untracked` and the revision carries it
(`followUpState`, `listOutstandingFollowUps`).

Three ways in:

1. **The form card.** A finalized card now has **Edit as new draft**. Pressing
   it opens the revision, and the card becomes that draft, editable with the
   usual Save and Finalize. The pointer on the chat message moves to the
   draft, so a refresh reopens the draft. Once that draft is finalized, the
   original's card says it was replaced and offers **Open newer version**.
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

## Verified against a real database

Besides the unit and end-to-end suites, the flow was run in the app (live
mode, local Supabase stack from `scripts/local-stack`, all migrations): create
→ finalize → Edit as new draft → chat correction → finalize; the three phrases
from the feedback; and delete-the-draft undo from Form Monitoring. That run
found one bug the in-memory fake cannot: an event kind outside the
`form_event_kind` enum. `event-kinds.test.ts` now checks every kind the code
writes against the migrations.
